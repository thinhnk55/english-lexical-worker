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
