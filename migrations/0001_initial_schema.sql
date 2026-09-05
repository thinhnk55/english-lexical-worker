-- Core authoring graph:
-- passage -> paragraphs -> sentences -> lexicals.

CREATE TABLE IF NOT EXISTS lexicals (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  translations TEXT NOT NULL DEFAULT '{}',
  phonemes TEXT,
  audio TEXT,
  image TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lexicals_text_type ON lexicals(text, type);
CREATE INDEX IF NOT EXISTS idx_lexicals_type ON lexicals(type);
CREATE INDEX IF NOT EXISTS idx_lexicals_text ON lexicals(text);

CREATE TABLE IF NOT EXISTS sentences (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  tokens TEXT,
  translations TEXT,
  phonemes TEXT,
  audio TEXT,
  image TEXT
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

CREATE TABLE IF NOT EXISTS passages (
  id TEXT PRIMARY KEY NOT NULL,
  title_sentence_id TEXT NOT NULL,
  image TEXT,
  FOREIGN KEY (title_sentence_id) REFERENCES sentences(id) ON DELETE RESTRICT
);

-- Admin explicitly publishes a fully hydrated snapshot to this table.
CREATE TABLE IF NOT EXISTS passages_runtime (
  passage_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paragraphs (
  id TEXT PRIMARY KEY NOT NULL,
  passage_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  image TEXT,
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE,
  UNIQUE (passage_id, position)
);

CREATE TABLE IF NOT EXISTS paragraph_sentences (
  id TEXT PRIMARY KEY NOT NULL,
  paragraph_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE,
  FOREIGN KEY (sentence_id) REFERENCES sentences(id) ON DELETE RESTRICT,
  UNIQUE (paragraph_id, position)
);

CREATE INDEX IF NOT EXISTS idx_paragraphs_passage ON paragraphs(passage_id, position);
CREATE INDEX IF NOT EXISTS idx_paragraph_sentences_paragraph ON paragraph_sentences(paragraph_id, position);
CREATE INDEX IF NOT EXISTS idx_paragraph_sentences_sentence ON paragraph_sentences(sentence_id);
