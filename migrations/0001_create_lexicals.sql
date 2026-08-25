CREATE TABLE IF NOT EXISTS lexicals (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  translations TEXT NOT NULL DEFAULT '{}',
  phonemes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lexicals_text_type ON lexicals(text, type);
CREATE INDEX IF NOT EXISTS idx_lexicals_type ON lexicals(type);
CREATE INDEX IF NOT EXISTS idx_lexicals_text ON lexicals(text);
