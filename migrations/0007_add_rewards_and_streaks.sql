-- One reward value per passage and one compact profile row per learner.
-- No reward ledger or check-in history is stored.
ALTER TABLE passages
  ADD COLUMN reward_points INTEGER NOT NULL DEFAULT 0 CHECK (reward_points >= 0);

ALTER TABLE learner_profiles
  ADD COLUMN reward_points INTEGER NOT NULL DEFAULT 0 CHECK (reward_points >= 0);

ALTER TABLE learner_profiles
  ADD COLUMN current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0);

ALTER TABLE learner_profiles
  ADD COLUMN longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= current_streak);

ALTER TABLE learner_profiles ADD COLUMN last_checkin_date TEXT;

-- NULL means not rewarded. Zero is a valid reward and still means rewarded.
ALTER TABLE learner_passages
  ADD COLUMN reward_points_awarded INTEGER
  CHECK (reward_points_awarded IS NULL OR reward_points_awarded >= 0);

CREATE TRIGGER IF NOT EXISTS trg_learner_passages_insert_without_reward
BEFORE INSERT ON learner_passages
WHEN NEW.reward_points_awarded IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'learner passage must be inserted without a reward');
END;

-- Completion and the reward snapshot must always change together.
CREATE TRIGGER IF NOT EXISTS trg_learner_passages_reward_lifecycle
BEFORE UPDATE OF completed_at, reward_points_awarded ON learner_passages
WHEN (NEW.completed_at IS NULL) IS NOT (NEW.reward_points_awarded IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'completion and passage reward must be confirmed together');
END;

-- The reward snapshot must come from the passage, never from a client value.
CREATE TRIGGER IF NOT EXISTS trg_learner_passages_validate_reward
BEFORE UPDATE OF completed_at, reward_points_awarded ON learner_passages
WHEN OLD.completed_at IS NULL
  AND NEW.completed_at IS NOT NULL
  AND NEW.reward_points_awarded IS NOT (
    SELECT reward_points FROM passages WHERE id = NEW.passage_id
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid passage reward');
END;

-- This trigger executes in the same SQLite transaction as completion. A retry
-- cannot award again because the completed learner-passage row is immutable.
CREATE TRIGGER IF NOT EXISTS trg_learner_passages_award_completion
AFTER UPDATE OF completed_at, reward_points_awarded ON learner_passages
WHEN OLD.completed_at IS NULL
  AND NEW.completed_at IS NOT NULL
  AND OLD.reward_points_awarded IS NULL
  AND NEW.reward_points_awarded IS NOT NULL
BEGIN
  INSERT INTO learner_profiles (user_id, reward_points, updated_at)
  VALUES (NEW.user_id, NEW.reward_points_awarded, unixepoch())
  ON CONFLICT(user_id) DO UPDATE SET
    reward_points = reward_points + excluded.reward_points,
    updated_at = unixepoch();
END;
