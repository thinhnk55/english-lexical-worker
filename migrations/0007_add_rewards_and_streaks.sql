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
  CHECK (
    reward_points_awarded IS NULL
    OR (reward_points_awarded >= 0 AND completed_at IS NOT NULL)
  );

-- This is deliberately the only business trigger in the schema. Awarding must
-- update learner_passages and learner_profiles atomically under concurrent
-- completion requests. The handler's conditional UPDATE changes the row once,
-- so this AFTER trigger also runs once and snapshots the server-owned reward.
CREATE TRIGGER IF NOT EXISTS trg_learner_passages_award_completion
AFTER UPDATE OF completed_at, reward_points_awarded ON learner_passages
WHEN OLD.completed_at IS NULL
  AND NEW.completed_at IS NOT NULL
BEGIN
  SELECT (CASE
    WHEN NEW.reward_points_awarded IS NULL
      OR NEW.reward_points_awarded IS NOT (
        SELECT reward_points FROM passages WHERE id = NEW.passage_id
      )
    THEN RAISE(ABORT, 'invalid passage completion reward')
  END);

  INSERT INTO learner_profiles (user_id, reward_points, updated_at)
  VALUES (NEW.user_id, NEW.reward_points_awarded, unixepoch())
  ON CONFLICT(user_id) DO UPDATE SET
    reward_points = reward_points + excluded.reward_points,
    updated_at = unixepoch();
END;
