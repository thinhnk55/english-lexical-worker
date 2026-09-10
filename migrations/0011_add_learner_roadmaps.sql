-- A learner may follow multiple administrator-curated roadmaps at the same
-- time, but may have only one flexible roadmap. Curated roadmap contents are
-- read from roadmap_passages so administrator edits are visible immediately.
CREATE TABLE IF NOT EXISTS learner_roadmaps (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  roadmap_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('curated', 'flexible')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE,
  CHECK (
    (kind = 'curated' AND roadmap_id IS NOT NULL)
    OR (kind = 'flexible' AND roadmap_id IS NULL)
  ),
  UNIQUE (user_id, roadmap_id)
);

-- SQLite treats NULL values as distinct in a UNIQUE constraint, so this
-- partial index is needed to guarantee one flexible roadmap per learner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_roadmaps_one_flexible
  ON learner_roadmaps(user_id)
  WHERE kind = 'flexible';

CREATE INDEX IF NOT EXISTS idx_learner_roadmaps_user_updated
  ON learner_roadmaps(user_id, updated_at DESC);

-- Flexible roadmap contents are explicitly selected by the learner. Curated
-- roadmap contents do not get copied here and therefore follow admin changes.
CREATE TABLE IF NOT EXISTS learner_roadmap_passages (
  id TEXT PRIMARY KEY NOT NULL,
  learner_roadmap_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (learner_roadmap_id) REFERENCES learner_roadmaps(id) ON DELETE CASCADE,
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT,
  UNIQUE (learner_roadmap_id, position),
  UNIQUE (learner_roadmap_id, passage_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_roadmap_passages_order
  ON learner_roadmap_passages(learner_roadmap_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_learner_roadmap_passages_passage
  ON learner_roadmap_passages(passage_id, learner_roadmap_id);
