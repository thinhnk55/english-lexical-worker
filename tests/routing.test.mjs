import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
const schema = await readFile(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8')

test('exposes the lexical CRUD routes', () => {
  assert.match(index, /url\.pathname === '\/lexicals'/)
  assert.match(index, /request\.method === 'POST'/)
  assert.match(index, /request\.method === 'PUT'/)
  assert.match(index, /request\.method === 'DELETE'/)
  assert.match(index, /const match = url\.pathname\.match/)
  assert.match(index, /url\.pathname === '\/sentences'/)
  assert.match(index, /sentence-lexicals/)
  assert.match(index, /url\.pathname === '\/passages'/)
  assert.match(index, /passageParagraphsMatch/)
  assert.match(index, /paragraphSentencesMatch/)
  assert.match(index, /paragraph-sentences/)
  assert.match(index, /passageRuntimeMatch/)
  assert.match(index, /handlePublishPassageRuntime/)
  assert.match(index, /handleDeletePassageRuntime/)
  assert.doesNotMatch(index, /readings/)
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

test('uses a fresh passage/paragraph schema with explicit ordered sentence mappings', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS lexicals/)
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lexicals_text_type/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sentences/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sentence_lexicals/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS passages/)
  assert.match(schema, /title_sentence_id TEXT NOT NULL/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS passages_runtime/)
  assert.match(schema, /payload TEXT NOT NULL/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS paragraphs/)
  assert.match(schema, /FOREIGN KEY \(passage_id\) REFERENCES passages\(id\) ON DELETE CASCADE/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS paragraph_sentences/)
  assert.match(schema, /FOREIGN KEY \(paragraph_id\) REFERENCES paragraphs\(id\) ON DELETE CASCADE/)
  assert.match(schema, /FOREIGN KEY \(sentence_id\) REFERENCES sentences\(id\) ON DELETE RESTRICT/)
  assert.match(schema, /UNIQUE \(paragraph_id, position\)/)
  assert.doesNotMatch(schema, /readings/)
})

test('adds nullable audio and image fields to the baseline schema at the appropriate content levels', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS lexicals[\s\S]*?audio TEXT,[\s\S]*?image TEXT/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sentences[\s\S]*?audio TEXT,[\s\S]*?image TEXT/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS passages[\s\S]*?image TEXT/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS paragraphs[\s\S]*?image TEXT/)
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS passages[\s\S]*?audio TEXT/)
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS paragraphs[\s\S]*?audio TEXT/)
})
