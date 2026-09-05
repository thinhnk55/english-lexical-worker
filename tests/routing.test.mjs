import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
const adminRouter = await readFile(new URL('../src/routes/admin.ts', import.meta.url), 'utf8')
const userRouter = await readFile(new URL('../src/routes/user.ts', import.meta.url), 'utf8')
const importHandlers = await readFile(new URL('../src/features/passage-import/handlers.ts', import.meta.url), 'utf8')
const migrationsDirectory = new URL('../migrations/', import.meta.url)
const migrationFiles = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort()
const migrations = await Promise.all(
  migrationFiles.map(async (name) => [name, await readFile(new URL(name, migrationsDirectory), 'utf8')]),
)
const migrationByName = new Map(migrations)
const schema = migrations.map(([, sql]) => sql).join('\n')

function tableDefinition(name) {
  const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`))
  assert.ok(match, `Missing table ${name}`)
  return match[1]
}

test('exposes the lexical CRUD routes', () => {
  assert.match(index, /routeAdminRequest/)
  assert.match(index, /routeUserRequest/)
  assert.match(index, /\/v1\/admin/)
  assert.match(index, /\/v1'/)
  assert.match(adminRouter, /path === '\/lexicals'/)
  assert.match(adminRouter, /request\.method === 'POST'/)
  assert.match(adminRouter, /request\.method === 'PUT'/)
  assert.match(adminRouter, /request\.method === 'DELETE'/)
  assert.match(adminRouter, /sentence-lexicals/)
  assert.match(adminRouter, /path === '\/passages'/)
  assert.match(adminRouter, /passageRuntimeMatch/)
  assert.match(adminRouter, /handlePublishPassageRuntime/)
  assert.match(adminRouter, /handleDeletePassageRuntime/)
  assert.match(adminRouter, /passages\/import\/preview/)
  assert.match(adminRouter, /handleCommitPassageImport/)
  assert.match(importHandlers, /handlePreviewPassageImport/)
  assert.match(importHandlers, /await env\.DB\.batch\(statements\)/)
  assert.match(importHandlers, /normalized_payload/)
  assert.match(adminRouter, /lexicals\/check-duplicates/)
  assert.match(adminRouter, /lexicals\/bulk/)
  assert.match(adminRouter, /taxonomies/)
  assert.match(adminRouter, /roadmaps/)
})

test('splits the schema into progressive reading-domain migrations', () => {
  assert.deepEqual(migrationFiles, [
    '0001_initial_schema.sql',
    '0002_classify_passages.sql',
    '0003_seed_passage_classification.sql',
    '0004_configure_passage_activities.sql',
    '0005_curate_reading_roadmaps.sql',
    '0006_track_learner_reading.sql',
    '0007_add_rewards_and_streaks.sql',
    '0008_review_saved_lexicals.sql',
  ])
})

test('seeds documented passage taxonomies with single-select CEFR', () => {
  const seed = migrationByName.get('0003_seed_passage_classification.sql')
  assert.ok(seed)
  const taxonomies = tableDefinition('taxonomies')
  const taxonomyTerms = tableDefinition('taxonomy_terms')
  assert.match(taxonomyTerms, /description TEXT NOT NULL/)
  assert.match(taxonomies, /selection_mode TEXT NOT NULL DEFAULT 'multiple'/)
  assert.match(taxonomies, /translations TEXT NOT NULL DEFAULT '\{\}'[\s\S]*?json_valid\(translations\)/)
  assert.match(taxonomyTerms, /translations TEXT NOT NULL DEFAULT '\{\}'[\s\S]*?json_valid\(translations\)/)

  for (const taxonomy of ['genre', 'topic', 'reading_skill', 'cefr']) {
    assert.match(seed, new RegExp(`'${taxonomy}'`))
  }
  assert.doesNotMatch(
    seed,
    /'[^']+', NULL, \d+\)[,;]/,
    'Every seeded taxonomy term must explain how an admin should classify a passage',
  )
  for (const level of ['a1', 'a2', 'b1', 'b2', 'c1', 'c2']) {
    assert.match(
      seed,
      new RegExp(`\\('cefr-${level}', 'taxonomy-cefr', NULL, '${level}', '${level.toUpperCase()}', '[^']+', '\\{"vi":`,),
    )
  }
  assert.equal(seed.match(/'\{"vi":\{"name":/g)?.length, 37)
  assert.match(seed, /'taxonomy-cefr'[\s\S]*?'single'/)
  assert.doesNotMatch(seed, /difficulty-internal|difficulty-lexile|lexile-/i)
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
  const lexicals = tableDefinition('lexicals')
  const sentences = tableDefinition('sentences')
  const passages = tableDefinition('passages')
  const paragraphs = tableDefinition('paragraphs')

  assert.match(lexicals, /audio TEXT,[\s\S]*?image TEXT/)
  assert.match(sentences, /audio TEXT,[\s\S]*?image TEXT/)
  assert.match(passages, /image TEXT/)
  assert.match(paragraphs, /image TEXT/)
  assert.doesNotMatch(passages, /audio TEXT/)
  assert.doesNotMatch(paragraphs, /audio TEXT/)
})

test('models unified classification, difficulty, reading paths, progress, rewards, and streaks', () => {
  for (const table of [
    'taxonomies',
    'taxonomy_terms',
    'passage_terms',
    'passage_activities',
    'roadmaps',
    'roadmap_passages',
    'learner_profiles',
    'learner_passages',
    'learner_activity_progress',
  ]) {
    tableDefinition(table)
  }

  assert.match(schema, /ALTER TABLE passages ADD COLUMN difficulty INTEGER[\s\S]*?typeof\(difficulty\) = 'integer'/)
  assert.doesNotMatch(schema, /difficulty BETWEEN 0 AND 100/)
  assert.match(schema, /trg_passage_terms_enforce_single_insert/)
  assert.match(schema, /trg_passage_terms_enforce_single_update/)
  assert.doesNotMatch(schema, /trg_passages_runtime_require_classification/)
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS difficulty_scales/)
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS difficulty_levels/)
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS passage_difficulties/)
  assert.doesNotMatch(schema, /lexile/i)
  assert.match(schema, /idx_learner_passages_one_active[\s\S]*?WHERE completed_at IS NULL/)
  assert.match(schema, /UNIQUE \(user_id, passage_id\)/)
  assert.match(schema, /trg_learner_passages_validate_reward/)
  assert.match(schema, /trg_learner_passages_award_completion/)
  assert.match(schema, /trg_learner_passages_completed_immutable/)
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS users/)
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS learner_checkins/)
})

test('stores only learner-selected lexical review scores and exposes lightweight review APIs', async () => {
  const learnerLexicals = tableDefinition('learner_lexicals')
  const handlers = await readFile(new URL('../src/features/learner-lexicals/handlers.ts', import.meta.url), 'utf8')
  const auth = await readFile(new URL('../src/utils/auth.ts', import.meta.url), 'utf8')

  assert.match(learnerLexicals, /PRIMARY KEY \(user_id, lexical_id\)/)
  assert.match(learnerLexicals, /meaning_score REAL/)
  assert.match(learnerLexicals, /pronunciation_score REAL/)
  assert.match(learnerLexicals, /review_score REAL/)
  assert.match(learnerLexicals, /last_reviewed_at INTEGER/)
  assert.doesNotMatch(learnerLexicals, /next_review_at|interval|ease_factor|mastery|learner_passage_id/)
  assert.match(schema, /idx_learner_lexicals_review_selection/)

  assert.match(userRouter, /path === '\/me\/lexicals'/)
  assert.match(userRouter, /path === '\/me\/lexicals\/review'/)
  assert.match(userRouter, /handleSelectLearnerLexicalsForReview/)
  assert.match(userRouter, /handleUpdateLearnerLexicalReviewResults/)
  assert.match(userRouter, /me\/reading\/active/)
  assert.match(userRouter, /me\/reading\/history/)
  assert.match(userRouter, /me\/reading\/summary/)
  assert.match(userRouter, /handleCompleteActiveReading/)
  assert.match(index, /requireUser/)
  assert.match(auth, /export async function requireUser/)

  assert.match(handlers, /saved\.review_score ASC/)
  assert.match(handlers, /saved\.last_reviewed_at ASC/)
  assert.match(handlers, /MAX_REVIEW_LIMIT = 50/)
  assert.match(handlers, /await env\.DB\.batch\(results\.map/)
  assert.doesNotMatch(handlers, /next_review_at|spaced|mastery|error_summary/)
})
