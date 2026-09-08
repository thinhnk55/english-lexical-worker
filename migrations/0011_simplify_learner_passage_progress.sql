-- A learner passage is a compact, current snapshot owned by the client.
-- Activities intentionally do not have server-side progress tables: their
-- shape evolves with the activity UX and is stored together in `progress`.

DROP TRIGGER IF EXISTS trg_learner_passages_award_completion;
DROP INDEX IF EXISTS idx_learner_passages_one_active;
DROP INDEX IF EXISTS idx_learner_passages_history;
DROP INDEX IF EXISTS idx_learner_passages_passage;
DROP INDEX IF EXISTS idx_learner_activity_progress_activity;
DROP TABLE IF EXISTS learner_activity_progress;

CREATE TABLE learner_passages_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(progress) AND json_type(progress) = 'object'),
  first_started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_studied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  reward_points_awarded INTEGER
    CHECK (
      reward_points_awarded IS NULL
      OR (reward_points_awarded >= 0 AND completed_at IS NOT NULL)
    ),
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT,
  UNIQUE (user_id, passage_id),
  CHECK (completed_at IS NULL OR completed_at >= first_started_at)
);

INSERT INTO learner_passages_next (
  id,
  user_id,
  passage_id,
  progress,
  first_started_at,
  last_studied_at,
  completed_at,
  reward_points_awarded
)
SELECT
  id,
  user_id,
  passage_id,
  '{}',
  started_at,
  COALESCE(completed_at, started_at),
  completed_at,
  reward_points_awarded
FROM learner_passages;

DROP TABLE learner_passages;
ALTER TABLE learner_passages_next RENAME TO learner_passages;

CREATE INDEX idx_learner_passages_recent
  ON learner_passages(user_id, last_studied_at DESC);

CREATE INDEX idx_learner_passages_completed
  ON learner_passages(user_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX idx_learner_passages_passage
  ON learner_passages(passage_id, completed_at);

-- The completion update in the handler is conditional, so this trigger can
-- only award the configured passage reward once for each learner passage.
CREATE TRIGGER trg_learner_passages_award_completion
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
