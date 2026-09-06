import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const schema = readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8')

function sqlite(database, sql) {
  return execFileSync('/usr/bin/sqlite3', [database], {
    input: `PRAGMA foreign_keys = ON;\n${sql}`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

test('allows contextual lexical identities and overlapping token mappings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lexical-schema-'))
  const database = join(directory, 'reading.sqlite')

  try {
    sqlite(database, schema)
    sqlite(database, `
      INSERT INTO sentences (id, text, tokens) VALUES
        ('title-1', 'Cars', '["Cars"]'),
        ('sentence-1', 'I bought a blue car and another car.', '["I","bought","a","blue","car","and","another","car","."]'),
        ('title-2', 'Transport', '["Transport"]'),
        ('sentence-2', 'The car is red.', '["The","car","is","red","."]');
      INSERT INTO passages (id, title_sentence_id, image) VALUES
        ('passage-1', 'title-1', NULL),
        ('passage-2', 'title-2', NULL);
      INSERT INTO paragraphs (id, passage_id, position, image) VALUES
        ('paragraph-1', 'passage-1', 0, NULL),
        ('paragraph-2', 'passage-2', 0, NULL);
      INSERT INTO paragraph_sentences (id, paragraph_id, sentence_id, position) VALUES
        ('paragraph-sentence-1', 'paragraph-1', 'sentence-1', 0),
        ('paragraph-sentence-2', 'paragraph-2', 'sentence-2', 0);

      INSERT INTO lexicals (id, text, type, translations) VALUES
        ('lexical-car-1', 'car', 'vocabulary', '{"vi":"xe hơi"}'),
        ('lexical-car-2', 'car', 'vocabulary', '{"vi":"chiếc xe"}'),
        ('lexical-blue-car', 'a blue car', 'phrase', '{"vi":"một chiếc xe màu xanh"}'),
        ('lexical-car-other-passage', 'car', 'vocabulary', '{"vi":"ô tô"}');

      INSERT INTO sentence_lexicals (id, sentence_id, lexical_id, position, token_indexes) VALUES
        ('mapping-car-first', 'sentence-1', 'lexical-car-1', 0, '[4]'),
        ('mapping-blue-car', 'sentence-1', 'lexical-blue-car', 1, '[2,3,4]'),
        ('mapping-car-second', 'sentence-1', 'lexical-car-1', 2, '[7]'),
        ('mapping-car-alternative', 'sentence-1', 'lexical-car-2', 3, '[4]'),
        ('mapping-car-other-passage', 'sentence-2', 'lexical-car-other-passage', 0, '[1]');
    `)

    assert.equal(sqlite(database, 'SELECT COUNT(*) FROM lexicals WHERE text = \'car\';'), '3')
    assert.equal(sqlite(database, 'SELECT COUNT(*) FROM sentence_lexicals WHERE sentence_id = \'sentence-1\';'), '4')
    assert.equal(sqlite(database, "SELECT COUNT(*) FROM passage_lexicals WHERE passage_id = 'passage-1';"), '3')

    assert.throws(() => sqlite(database, `
      INSERT INTO sentence_lexicals (id, sentence_id, lexical_id, position, token_indexes)
      VALUES ('invalid-token-json', 'sentence-1', 'lexical-car-1', 4, '4');
    `), /CHECK constraint failed/u)

    assert.throws(() => sqlite(database, `
      INSERT INTO paragraph_sentences (id, paragraph_id, sentence_id, position)
      VALUES ('shared-sentence', 'paragraph-2', 'sentence-1', 1);
    `), /UNIQUE constraint failed/u)

    sqlite(database, "DELETE FROM lexicals WHERE id = 'lexical-blue-car';")
    assert.equal(sqlite(database, "SELECT COUNT(*) FROM sentence_lexicals WHERE id = 'mapping-blue-car';"), '0')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
