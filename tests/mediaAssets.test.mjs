import assert from 'node:assert/strict'
import test from 'node:test'
import { assetKey, deleteAssetKeys, entityAssetKeys } from '../src/features/media/assets.ts'

test('derives one stable canonical key from the entity id', () => {
  assert.equal(assetKey('sentences', 'sentence-01', 'audio'), 'sentences/sentence-01/audio.opus')
  assert.equal(assetKey('lexicals', 'lexical-01', 'image'), 'lexicals/lexical-01/image.avif')
  assert.deepEqual(entityAssetKeys('passages', 'passage-01'), ['passages/passage-01/image.avif'])
})

test('deletes large asset collections in awaited R2 batches', async () => {
  const batches = []
  const env = { ASSETS: { delete: async (keys) => { batches.push(keys) } } }
  await deleteAssetKeys(env, Array.from({ length: 1_002 }, (_, index) => `sentences/${index}/audio.opus`))
  assert.deepEqual(batches.map((batch) => batch.length), [500, 500, 2])
})
