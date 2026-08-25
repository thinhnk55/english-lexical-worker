CREATE TABLE IF NOT EXISTS lexicals (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  translations TEXT NOT NULL DEFAULT '{}',
  phonemes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lexicals_text_type ON lexicals(text, type);
CREATE INDEX IF NOT EXISTS idx_lexicals_type ON lexicals(type);
CREATE INDEX IF NOT EXISTS idx_lexicals_text ON lexicals(text);

CREATE TABLE IF NOT EXISTS sentences (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  tokens TEXT,
  translations TEXT,
  phonemes TEXT
);

CREATE TABLE IF NOT EXISTS sentence_lexicals (
  id TEXT PRIMARY KEY NOT NULL,
  sentence_id TEXT NOT NULL,
  lexical_id TEXT NOT NULL,
  position INTEGER,
  token_indexes TEXT,
  FOREIGN KEY (sentence_id) REFERENCES sentences(id) ON DELETE CASCADE,
  FOREIGN KEY (lexical_id) REFERENCES lexicals(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sentences_text ON sentences(text);
CREATE INDEX IF NOT EXISTS idx_sentence_lexicals_sentence ON sentence_lexicals(sentence_id);
CREATE INDEX IF NOT EXISTS idx_sentence_lexicals_lexical ON sentence_lexicals(lexical_id);

CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY NOT NULL,
  title_sentence_id TEXT NOT NULL,
  FOREIGN KEY (title_sentence_id) REFERENCES sentences(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reading_sentences (
  reading_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (reading_id, position),
  FOREIGN KEY (reading_id) REFERENCES readings(id) ON DELETE CASCADE,
  FOREIGN KEY (sentence_id) REFERENCES sentences(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reading_sentences_sentence ON reading_sentences(sentence_id);
