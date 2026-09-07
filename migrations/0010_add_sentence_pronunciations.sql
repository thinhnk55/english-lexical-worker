-- Token-aligned CMU pronunciations keep word boundaries for lexical inheritance
-- and allow TTS to retain the original sentence punctuation and whitespace.
ALTER TABLE sentences
  ADD COLUMN pronunciations TEXT CHECK (
    pronunciations IS NULL
    OR (json_valid(pronunciations) AND json_type(pronunciations) = 'array')
  );
