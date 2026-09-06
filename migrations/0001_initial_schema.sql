-- Core authoring graph:
-- passage -> paragraphs -> sentences -> lexicals.

CREATE TABLE IF NOT EXISTS lexicals (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN ('vocabulary', 'phrase', 'collocation', 'phrasal_verb', 'idiom', 'pattern')
  ),
  translations TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(translations) AND json_type(translations) = 'object'
  ),
  phonemes TEXT,
  audio TEXT,
  image TEXT
);

-- Text is not a global identity. The same surface text can carry a different
-- contextual meaning in another passage, or even in the same passage when an
-- administrator explicitly decides it represents another learning item.
CREATE INDEX IF NOT EXISTS idx_lexicals_text_type
  ON lexicals(text COLLATE NOCASE, type);
CREATE INDEX IF NOT EXISTS idx_lexicals_type ON lexicals(type);
CREATE INDEX IF NOT EXISTS idx_lexicals_text ON lexicals(text);

CREATE TABLE IF NOT EXISTS sentences (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  tokens TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(tokens) AND json_type(tokens) = 'array'
  ),
  translations TEXT CHECK (
    translations IS NULL
    OR (json_valid(translations) AND json_type(translations) = 'object')
  ),
  phonemes TEXT,
  audio TEXT,
  image TEXT
);

CREATE TABLE IF NOT EXISTS sentence_lexicals (
  id TEXT PRIMARY KEY NOT NULL,
  sentence_id TEXT NOT NULL,
  lexical_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  token_indexes TEXT NOT NULL CHECK (
    json_valid(token_indexes)
    AND json_type(token_indexes) = 'array'
    AND json_array_length(token_indexes) > 0
  ),
  FOREIGN KEY (sentence_id) REFERENCES sentences(id) ON DELETE CASCADE,
  FOREIGN KEY (lexical_id) REFERENCES lexicals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sentences_text ON sentences(text);
CREATE INDEX IF NOT EXISTS idx_sentence_lexicals_sentence ON sentence_lexicals(sentence_id);
CREATE INDEX IF NOT EXISTS idx_sentence_lexicals_lexical ON sentence_lexicals(lexical_id);

CREATE TABLE IF NOT EXISTS passages (
  id TEXT PRIMARY KEY NOT NULL,
  title_sentence_id TEXT NOT NULL,
  image TEXT,
  FOREIGN KEY (title_sentence_id) REFERENCES sentences(id) ON DELETE RESTRICT,
  UNIQUE (title_sentence_id)
);

-- Admin explicitly publishes a fully hydrated snapshot to this table.
CREATE TABLE IF NOT EXISTS passages_runtime (
  passage_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paragraphs (
  id TEXT PRIMARY KEY NOT NULL,
  passage_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
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
  UNIQUE (paragraph_id, position),
  UNIQUE (sentence_id)
);

CREATE INDEX IF NOT EXISTS idx_paragraphs_passage ON paragraphs(passage_id, position);
CREATE INDEX IF NOT EXISTS idx_paragraph_sentences_paragraph ON paragraph_sentences(paragraph_id, position);
CREATE INDEX IF NOT EXISTS idx_paragraph_sentences_sentence ON paragraph_sentences(sentence_id);

-- These views derive ownership through the normalized authoring graph. They
-- occupy no duplicated storage and keep admin joins readable. Runtime reads
-- continue to use passages_runtime instead of these views. Authoring APIs are
-- responsible for validating that title/body roles and lexical reuse remain
-- inside one passage before executing their atomic D1 batch.
CREATE VIEW IF NOT EXISTS sentence_passages AS
SELECT title_sentence_id AS sentence_id, id AS passage_id
FROM passages
UNION
SELECT mapping.sentence_id, paragraph.passage_id
FROM paragraph_sentences mapping
JOIN paragraphs paragraph ON paragraph.id = mapping.paragraph_id;

CREATE VIEW IF NOT EXISTS passage_lexicals AS
SELECT DISTINCT owner.passage_id, mapping.lexical_id
FROM sentence_lexicals mapping
JOIN sentence_passages owner ON owner.sentence_id = mapping.sentence_id;
