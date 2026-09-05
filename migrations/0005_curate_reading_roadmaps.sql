-- Roadmap tables represent only the fixed mode curated by administrators.
-- The flexible mode is derived from each learner's ordered reading history.
CREATE TABLE IF NOT EXISTS roadmaps (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image TEXT,
  published_at INTEGER,
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (archived_at IS NULL OR published_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS roadmap_passages (
  id TEXT PRIMARY KEY NOT NULL,
  roadmap_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE,
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT,
  UNIQUE (roadmap_id, position),
  UNIQUE (roadmap_id, passage_id),
  UNIQUE (id, passage_id)
);

CREATE INDEX IF NOT EXISTS idx_roadmap_passages_passage
  ON roadmap_passages(passage_id, roadmap_id);
