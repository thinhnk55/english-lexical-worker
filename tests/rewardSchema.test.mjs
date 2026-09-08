import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const migrationsDirectory = new URL('../migrations/', import.meta.url)
const schema = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationsDirectory), 'utf8'))
  .join('\n')

function sqlite(database, sql) {
  return execFileSync('/usr/bin/sqlite3', [database], {
    input: `PRAGMA foreign_keys = ON;\n${sql}`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

test('keeps only the atomic award trigger and awards a completed passage once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reward-schema-'))
  const database = join(directory, 'reading.sqlite')
  try {
    sqlite(database, schema)
    assert.equal(
      sqlite(database, "SELECT group_concat(name) FROM sqlite_master WHERE type = 'trigger';"),
      'trg_learner_passages_award_completion',
    )
    sqlite(database, `
      INSERT INTO sentences (id, text, tokens) VALUES ('title', 'A title', '["A","title"]');
      INSERT INTO passages (id, title_sentence_id, reward_points) VALUES ('passage', 'title', 7);
      INSERT INTO learner_passages (id, user_id, passage_id)
      VALUES ('invalid-reading', 'other-learner', 'passage');
      INSERT INTO learner_passages (id, user_id, passage_id)
      VALUES ('reading', 'learner', 'passage');
      UPDATE learner_passages
      SET completed_at = unixepoch(), reward_points_awarded = (
        SELECT reward_points FROM passages WHERE id = learner_passages.passage_id
      )
      WHERE user_id = 'learner' AND completed_at IS NULL;
    `)
    assert.throws(() => sqlite(database, `
      UPDATE learner_passages
      SET completed_at = unixepoch(), reward_points_awarded = 999
      WHERE id = 'invalid-reading';
    `), /invalid passage completion reward/u)
    assert.equal(sqlite(database, "SELECT reward_points FROM learner_profiles WHERE user_id = 'learner';"), '7')
    sqlite(database, `
      UPDATE learner_passages
      SET completed_at = unixepoch(), reward_points_awarded = 7
      WHERE user_id = 'learner' AND completed_at IS NULL;
    `)
    assert.equal(sqlite(database, "SELECT reward_points FROM learner_profiles WHERE user_id = 'learner';"), '7')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
