import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
const migration = await readFile(new URL('../migrations/0001_create_lexicals.sql', import.meta.url), 'utf8')

test('exposes the lexical CRUD routes', () => {
  assert.match(index, /url\.pathname === '\/lexicals'/)
  assert.match(index, /request\.method === 'POST'/)
  assert.match(index, /request\.method === 'PUT'/)
  assert.match(index, /request\.method === 'DELETE'/)
  assert.match(index, /const match = url\.pathname\.match/)
  assert.match(index, /url\.pathname === '\/sentences'/)
  assert.match(index, /sentence-lexicals/)
})

test('stores the lexical fields and enforces text/type uniqueness', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lexicals/)
  assert.match(migration, /translations TEXT NOT NULL DEFAULT '\{\}'/)
  assert.match(migration, /phonemes TEXT/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lexicals_text_type/)
  assert.doesNotMatch(migration, /created_at/)
  assert.doesNotMatch(migration, /updated_at/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sentences/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sentence_lexicals/)
  assert.match(migration, /token_indexes TEXT/)
})
