export interface SentenceAuthoringContext {
  sentenceId: string;
  passageId: string;
  tokens: string[];
}

function parseTokens(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(token => typeof token === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

export async function getSentenceAuthoringContext(
  env: Env,
  sentenceId: string,
  passageId?: string,
): Promise<SentenceAuthoringContext | null> {
  const row = await env.DB.prepare(`
    SELECT owner.sentence_id, owner.passage_id, sentence.tokens
    FROM sentence_passages owner
    JOIN sentences sentence ON sentence.id = owner.sentence_id
    WHERE owner.sentence_id = ?
      AND (? IS NULL OR owner.passage_id = ?)
  `).bind(sentenceId, passageId ?? null, passageId ?? null).first<{
    sentence_id: string;
    passage_id: string;
    tokens: string | null;
  }>();
  return row ? {
    sentenceId: row.sentence_id,
    passageId: row.passage_id,
    tokens: parseTokens(row.tokens),
  } : null;
}

export async function passageIdsForSentence(env: Env, sentenceId: string): Promise<string[]> {
  const rows = await env.DB.prepare(`
    SELECT passage_id FROM sentence_passages WHERE sentence_id = ?
  `).bind(sentenceId).all<{ passage_id: string }>();
  return rows.results.map(row => row.passage_id);
}

export async function passageIdsForLexical(env: Env, lexicalId: string): Promise<string[]> {
  const rows = await env.DB.prepare(`
    SELECT passage_id FROM passage_lexicals WHERE lexical_id = ?
  `).bind(lexicalId).all<{ passage_id: string }>();
  return rows.results.map(row => row.passage_id);
}

export function invalidateRuntimeStatements(env: Env, passageIds: Iterable<string>): D1PreparedStatement[] {
  return [...new Set(passageIds)].map(passageId => (
    env.DB.prepare('DELETE FROM passages_runtime WHERE passage_id = ?').bind(passageId)
  ));
}

export function deleteOrphanLexicalStatements(env: Env, lexicalIds: Iterable<string>): D1PreparedStatement[] {
  return [...new Set(lexicalIds)].map(lexicalId => env.DB.prepare(`
    DELETE FROM lexicals
    WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM sentence_lexicals WHERE lexical_id = ?)
      AND NOT EXISTS (SELECT 1 FROM learner_lexicals WHERE lexical_id = ?)
  `).bind(lexicalId, lexicalId, lexicalId));
}

export function validateTokenIndexes(value: unknown, tokenCount: number): number[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return 'token_indexes phải là mảng có ít nhất một chỉ số';
  }
  const indexes: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!Number.isSafeInteger(item) || (item as number) < 0) {
      return 'token_indexes chỉ được chứa số nguyên không âm';
    }
    const index = item as number;
    if (index >= tokenCount) return `token_indexes chứa chỉ số ${index} vượt ngoài ${tokenCount} token`;
    if (seen.has(index)) return `token_indexes chứa chỉ số ${index} bị lặp`;
    seen.add(index);
    indexes.push(index);
  }
  return indexes;
}

export function parseStoredTokenIndexes(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(Number.isSafeInteger) ? parsed as number[] : [];
  } catch {
    return [];
  }
}
