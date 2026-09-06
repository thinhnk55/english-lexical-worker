-- Passage activity codes and their JSON configuration are deliberately open-ended.
-- Reading, pronunciation, comprehension, lexical quizzes, and future activity
-- types can be introduced without changing the database schema.
CREATE TABLE IF NOT EXISTS passage_activities (
  id TEXT PRIMARY KEY NOT NULL,
  passage_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE,
  UNIQUE (passage_id, position),
  UNIQUE (passage_id, code),
  UNIQUE (id, passage_id)
);

CREATE INDEX IF NOT EXISTS idx_passage_activities_passage
  ON passage_activities(passage_id, position);

-- The API never exposes passage_id as an updatable activity field. Reordering
-- and editing are performed within the owning passage in one D1 batch.
