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
  UNIQUE (id, passage_id)
);

CREATE INDEX IF NOT EXISTS idx_passage_activities_passage
  ON passage_activities(passage_id, position);

-- Moving an activity to another passage would invalidate learner results.
CREATE TRIGGER IF NOT EXISTS trg_passage_activities_passage_immutable
BEFORE UPDATE OF passage_id ON passage_activities
WHEN NEW.passage_id IS NOT OLD.passage_id
BEGIN
  SELECT RAISE(ABORT, 'passage activity cannot move to another passage');
END;
