-- SSO owns users. This table is only a reading-domain extension keyed by the
-- external user id; reward and streak fields are added in the next migration.
CREATE TABLE IF NOT EXISTS learner_profiles (
  user_id TEXT PRIMARY KEY NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- completed_at IS NULL means this is the learner's one active passage.
-- Abandoning deletes the active row. Completed rows are immutable history.
CREATE TABLE IF NOT EXISTS learner_passages (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fixed', 'flexible')),
  roadmap_passage_id TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT,
  FOREIGN KEY (roadmap_passage_id, passage_id) REFERENCES roadmap_passages(id, passage_id) ON DELETE RESTRICT,
  UNIQUE (user_id, passage_id),
  CHECK (
    (mode = 'fixed' AND roadmap_passage_id IS NOT NULL)
    OR (mode = 'flexible' AND roadmap_passage_id IS NULL)
  ),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_passages_one_active
  ON learner_passages(user_id)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_learner_passages_history
  ON learner_passages(user_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_learner_passages_passage
  ON learner_passages(passage_id, completed_at);

-- Only the latest state/result per activity is retained to minimize storage.
-- result can contain speech-assessment output or quiz answers.
CREATE TABLE IF NOT EXISTS learner_activity_progress (
  learner_passage_id TEXT NOT NULL,
  passage_activity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  score REAL,
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  audio TEXT,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (learner_passage_id, passage_activity_id),
  FOREIGN KEY (learner_passage_id) REFERENCES learner_passages(id) ON DELETE CASCADE,
  FOREIGN KEY (passage_activity_id) REFERENCES passage_activities(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learner_activity_progress_activity
  ON learner_activity_progress(passage_activity_id, status);

-- The public API only inserts active rows, only updates the current active row,
-- validates that activities belong to it, and only deletes unfinished rows.
-- These lifecycle rules intentionally live in visible handler queries.
