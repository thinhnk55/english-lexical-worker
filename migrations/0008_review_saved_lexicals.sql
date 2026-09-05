-- Learners explicitly save the lexicals they want to review. The client owns
-- assessment and ranking; the API only persists scores and selects the lowest
-- review_score values first.
CREATE TABLE IF NOT EXISTS learner_lexicals (
  user_id TEXT NOT NULL,
  lexical_id TEXT NOT NULL,
  meaning_score REAL
    CHECK (
      meaning_score IS NULL
      OR (
        typeof(meaning_score) IN ('integer', 'real')
        AND meaning_score BETWEEN 0 AND 100
      )
    ),
  pronunciation_score REAL
    CHECK (
      pronunciation_score IS NULL
      OR (
        typeof(pronunciation_score) IN ('integer', 'real')
        AND pronunciation_score BETWEEN 0 AND 100
      )
    ),
  review_score REAL
    CHECK (
      review_score IS NULL
      OR (
        typeof(review_score) IN ('integer', 'real')
        AND review_score BETWEEN 0 AND 100
      )
    ),
  last_reviewed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, lexical_id),
  FOREIGN KEY (lexical_id) REFERENCES lexicals(id) ON DELETE RESTRICT
);

-- SQLite orders NULL before numeric values in ascending order, so newly saved
-- and unassessed lexicals naturally come first. Lower client-provided scores
-- follow, with the oldest review breaking ties.
CREATE INDEX IF NOT EXISTS idx_learner_lexicals_review_selection
  ON learner_lexicals(
    user_id,
    review_score,
    last_reviewed_at,
    created_at,
    lexical_id
  );
