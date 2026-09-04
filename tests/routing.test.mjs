import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
const lexicalMigration = await readFile(new URL('../migrations/0001_create_lexicals.sql', import.meta.url), 'utf8')
const sentenceMigration = await readFile(new URL('../migrations/0002_create_sentences.sql', import.meta.url), 'utf8')
const readingMigration = await readFile(new URL('../migrations/0003_create_readings.sql', import.meta.url), 'utf8')

test('exposes the lexical CRUD routes', () => {
  assert.match(index, /url\.pathname === '\/lexicals'/)
  assert.match(index, /request\.method === 'POST'/)
  assert.match(index, /request\.method === 'PUT'/)
  assert.match(index, /request\.method === 'DELETE'/)
  assert.match(index, /const match = url\.pathname\.match/)
  assert.match(index, /url\.pathname === '\/sentences'/)
  assert.match(index, /sentence-lexicals/)
  assert.match(index, /url\.pathname === '\/readings'/)
  assert.match(index, /readingSentencesMatch/)
  assert.match(index, /lexicals\/check-duplicates/)
  assert.match(index, /lexicals\/bulk/)
})

test('exposes the fixed lexical types and keeps duplicate review separate from bulk writes', async () => {
  const constants = await readFile(new URL('../src/features/lexicals/constants.ts', import.meta.url), 'utf8')
  const handlers = await readFile(new URL('../src/features/lexicals/handlers.ts', import.meta.url), 'utf8')
  for (const type of ['vocabulary', 'phrase', 'collocation', 'phrasal_verb', 'idiom', 'pattern']) {
    assert.match(constants, new RegExp(`'${type}'`))
  }
  assert.match(handlers, /handleCheckLexicalDuplicates/)
  assert.match(handlers, /handleBulkLexicals/)
  assert.match(handlers, /duplicate_in_batch/)
})

test('stores the lexical fields and enforces text/type uniqueness', () => {
  assert.match(lexicalMigration, /CREATE TABLE IF NOT EXISTS lexicals/)
  assert.match(lexicalMigration, /translations TEXT NOT NULL DEFAULT '\{\}'/)
  assert.match(lexicalMigration, /phonemes TEXT/)
  assert.match(lexicalMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lexicals_text_type/)
  assert.doesNotMatch(lexicalMigration, /created_at/)
  assert.doesNotMatch(lexicalMigration, /updated_at/)
  assert.match(sentenceMigration, /CREATE TABLE IF NOT EXISTS sentences/)
  assert.match(sentenceMigration, /CREATE TABLE IF NOT EXISTS sentence_lexicals/)
  assert.match(sentenceMigration, /token_indexes TEXT/)
  assert.match(sentenceMigration, /FOREIGN KEY \(sentence_id\) REFERENCES sentences\(id\) ON DELETE CASCADE/)
  assert.match(sentenceMigration, /FOREIGN KEY \(lexical_id\) REFERENCES lexicals\(id\) ON DELETE RESTRICT/)
  assert.match(readingMigration, /CREATE TABLE IF NOT EXISTS readings/)
  assert.match(readingMigration, /CREATE TABLE IF NOT EXISTS reading_sentences/)
  assert.match(readingMigration, /PRIMARY KEY \(reading_id, position\)/)
  assert.match(readingMigration, /FOREIGN KEY \(title_sentence_id\) REFERENCES sentences\(id\) ON DELETE RESTRICT/)
})
