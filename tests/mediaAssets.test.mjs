import assert from 'node:assert/strict'
import test from 'node:test'
import { assetKey, deleteAssetKeys, entityAssetKeys, nextAssetUrl } from '../src/features/media/assets.ts'

test('derives one stable canonical key from the entity id', () => {
  assert.equal(assetKey('sentences', 'sentence-01', 'audio'), 'sentences/sentence-01/audio.opus')
  assert.equal(assetKey('lexicals', 'lexical-01', 'image'), 'lexicals/lexical-01/image.avif')
  assert.deepEqual(entityAssetKeys('passages', 'passage-01'), ['passages/passage-01/image.avif'])
})

test('keeps the first asset URL clean and increments a numeric cache version on replacement', () => {
  const base = 'https://english-lexical-api.hocnhe.com/assets/'
  const key = 'sentences/sentence-01/audio.opus'
  const first = nextAssetUrl(base, key, null)
  assert.equal(first, 'https://english-lexical-api.hocnhe.com/assets/sentences/sentence-01/audio.opus')
  assert.equal(nextAssetUrl(base, key, first), `${first}?v=2`)
  assert.equal(nextAssetUrl(base, key, `${first}?v=2`), `${first}?v=3`)
  assert.equal(nextAssetUrl(base, key, `${first}?v=legacy-uuid`), `${first}?v=2`)
})

test('deletes large asset collections in awaited R2 batches', async () => {
  const batches = []
  const env = { ASSETS: { delete: async (keys) => { batches.push(keys) } } }
  await deleteAssetKeys(env, Array.from({ length: 1_002 }, (_, index) => `sentences/${index}/audio.opus`))
  assert.deepEqual(batches.map((batch) => batch.length), [500, 500, 2])
})
