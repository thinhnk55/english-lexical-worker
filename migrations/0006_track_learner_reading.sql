-- SSO owns users. This table is only a reading-domain extension keyed by the
-- external user id; reward and streak fields are added in the next migration.
CREATE TABLE IF NOT EXISTS learner_profiles (
  user_id TEXT PRIMARY KEY NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- One compact, current snapshot per learner and passage.  Activity state is
-- deliberately owned by the client and stored together in `progress`, so new
-- activity UX does not require another server-side progress schema.
CREATE TABLE IF NOT EXISTS learner_passages (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(progress) AND json_type(progress) = 'object'),
  first_started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_studied_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT,
  UNIQUE (user_id, passage_id),
  CHECK (completed_at IS NULL OR completed_at >= first_started_at)
);

CREATE INDEX IF NOT EXISTS idx_learner_passages_recent
  ON learner_passages(user_id, last_studied_at DESC);

CREATE INDEX IF NOT EXISTS idx_learner_passages_completed
  ON learner_passages(user_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learner_passages_passage
  ON learner_passages(passage_id, completed_at);
