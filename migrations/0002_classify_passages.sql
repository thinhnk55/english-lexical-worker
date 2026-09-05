-- Discovery metadata shown before a learner selects a passage.
ALTER TABLE passages ADD COLUMN summary TEXT;
-- Product-owned continuous score. Higher values mean a harder passage. The
-- scoring service owns the scale and may use negative or values above 100.
ALTER TABLE passages ADD COLUMN difficulty INTEGER
  CHECK (difficulty IS NULL OR typeof(difficulty) = 'integer');

CREATE INDEX IF NOT EXISTS idx_passages_difficulty ON passages(difficulty);

-- Classification is data-driven instead of being hard-coded as a passage type.
-- Examples of taxonomies are genre, topic, skill, CEFR, audience, or theme.
CREATE TABLE IF NOT EXISTS taxonomies (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  -- English is stored in name/description. Other locales use
  -- {"<locale>": {"name": "...", "description": "..."}}.
  translations TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(translations) AND json_type(translations) = 'object'),
  selection_mode TEXT NOT NULL DEFAULT 'multiple'
    CHECK (selection_mode IN ('single', 'multiple'))
);

CREATE TABLE IF NOT EXISTS taxonomy_terms (
  id TEXT PRIMARY KEY NOT NULL,
  taxonomy_id TEXT NOT NULL,
  parent_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  translations TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(translations) AND json_type(translations) = 'object'),
  position INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (taxonomy_id) REFERENCES taxonomies(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id, taxonomy_id) REFERENCES taxonomy_terms(id, taxonomy_id) ON DELETE CASCADE,
  UNIQUE (taxonomy_id, code),
  UNIQUE (id, taxonomy_id)
);

CREATE TABLE IF NOT EXISTS passage_terms (
  passage_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  PRIMARY KEY (passage_id, term_id),
  FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE,
  FOREIGN KEY (term_id) REFERENCES taxonomy_terms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_parent ON taxonomy_terms(taxonomy_id, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_passage_terms_term ON passage_terms(term_id, passage_id);

-- A single-select taxonomy, such as CEFR, may contribute at most one term to a
-- passage. Multi-select taxonomies continue to support any number of terms.
CREATE TRIGGER IF NOT EXISTS trg_passage_terms_enforce_single_insert
BEFORE INSERT ON passage_terms
WHEN EXISTS (
  SELECT 1
  FROM taxonomy_terms proposed
  JOIN taxonomies taxonomy ON taxonomy.id = proposed.taxonomy_id
  WHERE proposed.id = NEW.term_id
    AND taxonomy.selection_mode = 'single'
    AND EXISTS (
      SELECT 1
      FROM passage_terms assigned
      JOIN taxonomy_terms existing ON existing.id = assigned.term_id
      WHERE assigned.passage_id = NEW.passage_id
        AND existing.taxonomy_id = proposed.taxonomy_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'passage already has a term for this single-select taxonomy');
END;

CREATE TRIGGER IF NOT EXISTS trg_passage_terms_enforce_single_update
BEFORE UPDATE OF passage_id, term_id ON passage_terms
WHEN EXISTS (
  SELECT 1
  FROM taxonomy_terms proposed
  JOIN taxonomies taxonomy ON taxonomy.id = proposed.taxonomy_id
  WHERE proposed.id = NEW.term_id
    AND taxonomy.selection_mode = 'single'
    AND EXISTS (
      SELECT 1
      FROM passage_terms assigned
      JOIN taxonomy_terms existing ON existing.id = assigned.term_id
      WHERE assigned.passage_id = NEW.passage_id
        AND existing.taxonomy_id = proposed.taxonomy_id
        AND assigned.rowid <> OLD.rowid
    )
)
BEGIN
  SELECT RAISE(ABORT, 'passage already has a term for this single-select taxonomy');
END;

CREATE TRIGGER IF NOT EXISTS trg_taxonomies_enforce_single_update
BEFORE UPDATE OF selection_mode ON taxonomies
WHEN NEW.selection_mode = 'single'
  AND EXISTS (
    SELECT 1
    FROM passage_terms assigned
    JOIN taxonomy_terms term ON term.id = assigned.term_id
    WHERE term.taxonomy_id = NEW.id
    GROUP BY assigned.passage_id
    HAVING COUNT(*) > 1
  )
BEGIN
  SELECT RAISE(ABORT, 'taxonomy has passages with multiple assigned terms');
END;
