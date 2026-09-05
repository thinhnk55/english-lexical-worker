import { parsePagination } from '../../utils/pagination';
import { errorResponse, successResponse } from '../../utils/response';

const DEFAULT_REVIEW_LIMIT = 20;
const MAX_REVIEW_LIMIT = 50;
const MAX_REVIEW_RESULTS = 50;

interface LearnerLexicalRow {
  lexical_id: string;
  text: string;
  type: string;
  translations: string;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
  meaning_score: number | null;
  pronunciation_score: number | null;
  review_score: number | null;
  last_reviewed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface LearnerLexical {
  lexical_id: string;
  text: string;
  type: string;
  translations: Record<string, string>;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
  meaning_score: number | null;
  pronunciation_score: number | null;
  review_score: number | null;
  last_reviewed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ReviewResult {
  lexical_id: string;
  meaning_score: number | null;
  pronunciation_score: number | null;
  review_score: number;
}

const learnerLexicalSelect = `
  SELECT
    saved.lexical_id,
    lexical.text,
    lexical.type,
    lexical.translations,
    lexical.phonemes,
    lexical.audio,
    lexical.image,
    saved.meaning_score,
    saved.pronunciation_score,
    saved.review_score,
    saved.last_reviewed_at,
    saved.created_at,
    saved.updated_at
  FROM learner_lexicals saved
  JOIN lexicals lexical ON lexical.id = saved.lexical_id
`;

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isForeignKeyConstraint(error: unknown): boolean {
  return error instanceof Error && /foreign key/i.test(error.message);
}

function parseTranslations(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    if (
      typeof parsed === 'object'
      && parsed !== null
      && !Array.isArray(parsed)
      && Object.values(parsed).every(translation => typeof translation === 'string')
    ) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Keep a stable response when a row was edited outside the API.
  }
  return {};
}

function parseRow(row: LearnerLexicalRow): LearnerLexical {
  return { ...row, translations: parseTranslations(row.translations) };
}

function parseReviewLimit(url: URL): number {
  const value = Number.parseInt(url.searchParams.get('limit') ?? String(DEFAULT_REVIEW_LIMIT), 10);
  if (!Number.isFinite(value)) return DEFAULT_REVIEW_LIMIT;
  return Math.min(MAX_REVIEW_LIMIT, Math.max(1, value));
}

function isNullableScore(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

async function readLexicalId(request: Request, origin: string): Promise<string | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu lexical không hợp lệ', origin);
  }
  const lexicalId = typeof (body as Record<string, unknown>).lexical_id === 'string'
    ? ((body as Record<string, unknown>).lexical_id as string).trim()
    : '';
  if (!lexicalId) return errorResponse(400, 'VALIDATION_ERROR', 'lexical_id không được để trống', origin);
  return lexicalId;
}

async function readReviewResults(request: Request, origin: string): Promise<ReviewResult[] | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu review không hợp lệ', origin);
  }
  const rawResults = (body as Record<string, unknown>).results;
  if (!Array.isArray(rawResults) || rawResults.length === 0 || rawResults.length > MAX_REVIEW_RESULTS) {
    return errorResponse(400, 'VALIDATION_ERROR', `results phải có từ 1 đến ${MAX_REVIEW_RESULTS} phần tử`, origin);
  }

  const results: ReviewResult[] = [];
  const lexicalIds = new Set<string>();
  for (let index = 0; index < rawResults.length; index += 1) {
    const rawResult = rawResults[index];
    if (typeof rawResult !== 'object' || rawResult === null || Array.isArray(rawResult)) {
      return errorResponse(400, 'VALIDATION_ERROR', `Kết quả thứ ${index + 1} không hợp lệ`, origin);
    }
    const value = rawResult as Record<string, unknown>;
    const lexicalId = typeof value.lexical_id === 'string' ? value.lexical_id.trim() : '';
    if (!lexicalId) {
      return errorResponse(400, 'VALIDATION_ERROR', `Kết quả thứ ${index + 1} thiếu lexical_id`, origin);
    }
    if (lexicalIds.has(lexicalId)) {
      return errorResponse(400, 'VALIDATION_ERROR', `lexical_id ${lexicalId} bị lặp trong results`, origin);
    }
    if (!isNullableScore(value.meaning_score)) {
      return errorResponse(400, 'VALIDATION_ERROR', `meaning_score của ${lexicalId} phải là null hoặc từ 0 đến 100`, origin);
    }
    if (!isNullableScore(value.pronunciation_score)) {
      return errorResponse(400, 'VALIDATION_ERROR', `pronunciation_score của ${lexicalId} phải là null hoặc từ 0 đến 100`, origin);
    }
    if (!isScore(value.review_score)) {
      return errorResponse(400, 'VALIDATION_ERROR', `review_score của ${lexicalId} phải từ 0 đến 100`, origin);
    }
    lexicalIds.add(lexicalId);
    results.push({
      lexical_id: lexicalId,
      meaning_score: value.meaning_score,
      pronunciation_score: value.pronunciation_score,
      review_score: value.review_score,
    });
  }
  return results;
}

async function getSavedLexicalsByIds(
  env: Env,
  userId: string,
  lexicalIds: string[],
): Promise<LearnerLexical[]> {
  const placeholders = lexicalIds.map(() => '?').join(', ');
  const rows = await env.DB.prepare(`
    ${learnerLexicalSelect}
    WHERE saved.user_id = ? AND saved.lexical_id IN (${placeholders})
  `).bind(userId, ...lexicalIds).all<LearnerLexicalRow>();
  const byId = new Map(rows.results.map(row => [row.lexical_id, parseRow(row)]));
  return lexicalIds.flatMap(lexicalId => {
    const row = byId.get(lexicalId);
    return row ? [row] : [];
  });
}

export async function handleSaveLearnerLexical(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
): Promise<Response> {
  const lexicalId = await readLexicalId(request, origin);
  if (isResponse(lexicalId)) return lexicalId;
  try {
    const result = await env.DB.prepare(`
      INSERT INTO learner_lexicals (user_id, lexical_id)
      VALUES (?, ?)
      ON CONFLICT(user_id, lexical_id) DO NOTHING
    `).bind(userId, lexicalId).run();
    const rows = await getSavedLexicalsByIds(env, userId, [lexicalId]);
    return successResponse(result.meta.changes ? 201 : 200, result.meta.changes ? 'CREATED' : 'SUCCESS', rows[0], origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) {
      return errorResponse(404, 'NOT_FOUND', 'Lexical không tồn tại', origin);
    }
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListLearnerLexicals(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { page, size, offset } = parsePagination(url);
    const [countRow, rows] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS total FROM learner_lexicals WHERE user_id = ?').bind(userId).first<{ total: number }>(),
      env.DB.prepare(`
        ${learnerLexicalSelect}
        WHERE saved.user_id = ?
        ORDER BY saved.created_at DESC, saved.lexical_id ASC
        LIMIT ? OFFSET ?
      `).bind(userId, size, offset).all<LearnerLexicalRow>(),
    ]);
    return successResponse(
      200,
      'SUCCESS',
      rows.results.map(parseRow),
      origin,
      { page, size, total: countRow?.total ?? 0 },
    );
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleSelectLearnerLexicalsForReview(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
): Promise<Response> {
  try {
    const limit = parseReviewLimit(new URL(request.url));
    const rows = await env.DB.prepare(`
      ${learnerLexicalSelect}
      WHERE saved.user_id = ?
      ORDER BY
        saved.review_score ASC,
        saved.last_reviewed_at ASC,
        saved.created_at ASC,
        saved.lexical_id ASC
      LIMIT ?
    `).bind(userId, limit).all<LearnerLexicalRow>();
    return successResponse(200, 'SUCCESS', rows.results.map(parseRow), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateLearnerLexicalReviewResults(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
): Promise<Response> {
  const results = await readReviewResults(request, origin);
  if (isResponse(results)) return results;
  try {
    const lexicalIds = results.map(result => result.lexical_id);
    const saved = await getSavedLexicalsByIds(env, userId, lexicalIds);
    if (saved.length !== lexicalIds.length) {
      const savedIds = new Set(saved.map(row => row.lexical_id));
      return errorResponse(404, 'NOT_FOUND', {
        lexical_ids: lexicalIds.filter(lexicalId => !savedIds.has(lexicalId)),
      }, origin);
    }

    const reviewedAt = Math.floor(Date.now() / 1000);
    const statement = env.DB.prepare(`
      UPDATE learner_lexicals
      SET
        meaning_score = ?,
        pronunciation_score = ?,
        review_score = ?,
        last_reviewed_at = ?,
        updated_at = ?
      WHERE user_id = ? AND lexical_id = ?
    `);
    await env.DB.batch(results.map(result => statement.bind(
      result.meaning_score,
      result.pronunciation_score,
      result.review_score,
      reviewedAt,
      reviewedAt,
      userId,
      result.lexical_id,
    )));

    const updated = await getSavedLexicalsByIds(env, userId, lexicalIds);
    return successResponse(200, 'UPDATED', updated, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteLearnerLexical(
  env: Env,
  origin: string,
  userId: string,
  lexicalId: string,
): Promise<Response> {
  try {
    const result = await env.DB.prepare(`
      DELETE FROM learner_lexicals
      WHERE user_id = ? AND lexical_id = ?
    `).bind(userId, lexicalId).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
