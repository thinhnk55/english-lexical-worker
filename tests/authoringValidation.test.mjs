import assert from 'node:assert/strict'
import test from 'node:test'
import { validateTokenIndexes } from '../src/features/authoring/context.ts'
import { passageDraftFromText } from '../src/features/passage-import/draft.ts'
import { lexicalDraftMetadata } from '../src/features/lexicals/draft.ts'
import { getCorsOrigin } from '../src/utils/cors.ts'

test('validates token indexes without forbidding overlaps between lexical mappings', () => {
  assert.deepEqual(validateTokenIndexes([2, 3, 4], 8), [2, 3, 4])
  assert.deepEqual(validateTokenIndexes([4], 8), [4])
  assert.match(validateTokenIndexes([], 8), /ít nhất một/u)
  assert.match(validateTokenIndexes([4, 4], 8), /bị lặp/u)
  assert.match(validateTokenIndexes([8], 8), /vượt ngoài/u)
})

test('creates a passage skeleton from title, blank-line paragraphs and sentences', () => {
  assert.deepEqual(passageDraftFromText(`The Little Seed

The seed waits. Rain begins!

Soon, it grows.`), {
    title: { text: 'The Little Seed', lexicals: [] },
    paragraphs: [
      { sentences: [
        { text: 'The seed waits.', lexicals: [] },
        { text: 'Rain begins!', lexicals: [] },
      ] },
      { sentences: [{ text: 'Soon, it grows.', lexicals: [] }] },
    ],
  })
})

test('allows trusted hocnhe/local origins and rejects arbitrary credentialed origins', () => {
  assert.equal(getCorsOrigin(new Request('https://api.test')).allowed, true)
  assert.deepEqual(
    getCorsOrigin(new Request('https://api.test', { headers: { Origin: 'https://english.hocnhe.com' } })),
    { allowed: true, origin: 'https://english.hocnhe.com' },
  )
  assert.equal(
    getCorsOrigin(new Request('https://api.test', { headers: { Origin: 'https://attacker.example' } })).allowed,
    false,
  )
})

test('allows a lexical draft before translations and phonemes are authored', () => {
  assert.deepEqual(lexicalDraftMetadata({ text: 'seed', type: 'vocabulary' }), {
    translations: {},
    phonemes: null,
  })
})
