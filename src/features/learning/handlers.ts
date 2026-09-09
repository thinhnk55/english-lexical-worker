import { parsePagination } from '../../utils/pagination';
import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';

interface RuntimeRow {
  payload: string;
  updated_at: number;
}

interface LibraryPassageRow {
  id: string;
  title: string;
  title_translations: string | null;
  image: string | null;
  summary: string | null;
  difficulty: number | null;
  reward_points: number;
  runtime_updated_at: number;
}

interface TermRow {
  passage_id: string;
  id: string;
  code: string;
  name: string;
  description: string;
  translations: string;
  taxonomy_id: string;
  taxonomy_code: string;
  taxonomy_name: string;
  taxonomy_description: string | null;
  taxonomy_translations: string;
}

interface LearnerPassageRow {
  id: string;
  user_id: string;
  passage_id: string;
  progress: string;
  first_started_at: number;
  last_studied_at: number;
  completed_at: number | null;
  reward_points_awarded: number | null;
}

interface ProfileRow {
  user_id: string;
  reward_points: number;
  current_streak: number;
  longest_streak: number;
  last_checkin_date: string | null;
  updated_at: number;
}

const MAX_PROGRESS_BYTES = 64 * 1024;

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint|unique|foreign key/i.test(error.message);
}

function parseJson(value: string | null, fallback: unknown): unknown {
  if (value === null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseRuntime(row: RuntimeRow): { payload: unknown; updated_at: number } | null {
  try {
    return { payload: JSON.parse(row.payload), updated_at: row.updated_at };
  } catch {
    return null;
  }
}

async function readObject(request: Request, origin: string): Promise<Record<string, unknown> | Response> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu phải là một JSON object', origin);
    }
    return body as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
}

function parseOptionalSafeInteger(value: string | null, field: string, origin: string): number | null | Response {
  if (value === null || value.trim() === '') return null;
  if (!/^-?\d+$/.test(value)) return errorResponse(400, 'VALIDATION_ERROR', `${field} phải là số nguyên`, origin);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return errorResponse(400, 'VALIDATION_ERROR', `${field} vượt quá giới hạn`, origin);
  return parsed;
}

async function getRuntime(env: Env, passageId: string): Promise<RuntimeRow | null> {
  return env.DB.prepare(`
    SELECT payload, updated_at FROM passages_runtime WHERE passage_id = ?
  `).bind(passageId).first<RuntimeRow>();
}

async function passageExists(env: Env, passageId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM passages WHERE id = ?').bind(passageId).first<{ id: string }>();
  return Boolean(row);
}

function parseProgressSnapshot(value: string): Record<string, unknown> {
  const parsed = parseJson(value, {});
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

async function readProgressSnapshot(request: Request, origin: string): Promise<Record<string, unknown> | Response> {
  const body = await readObject(request, origin);
  if (isResponse(body)) return body;
  const progress = body.progress;
  if (typeof progress !== 'object' || progress === null || Array.isArray(progress)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'progress phải là một JSON object', origin);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(progress);
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'progress không thể chuyển thành JSON', origin);
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROGRESS_BYTES) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'progress vượt quá 64 KB', origin);
  }
  return progress as Record<string, unknown>;
}

async function getLearnerPassage(env: Env, userId: string, passageId: string): Promise<LearnerPassageRow | null> {
  return env.DB.prepare(`
    SELECT id, user_id, passage_id, progress, first_started_at, last_studied_at, completed_at, reward_points_awarded
    FROM learner_passages
    WHERE user_id = ? AND passage_id = ?
  `).bind(userId, passageId).first<LearnerPassageRow>();
}

async function saveProgressSnapshot(
  env: Env,
  userId: string,
  passageId: string,
  progress: Record<string, unknown>,
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO learner_passages (id, user_id, passage_id, progress, first_started_at, last_studied_at)
    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(user_id, passage_id) DO UPDATE SET
      progress = excluded.progress,
      last_studied_at = unixepoch()
  `).bind(generateUUIDv7(), userId, passageId, JSON.stringify(progress)).run();
}

function presentLearnerPassage(row: LearnerPassageRow) {
  return {
    id: row.id,
    passage_id: row.passage_id,
    progress: parseProgressSnapshot(row.progress),
    first_started_at: row.first_started_at,
    last_studied_at: row.last_studied_at,
    completed_at: row.completed_at,
    reward_points_awarded: row.reward_points_awarded,
  };
}

async function ensureProfile(env: Env, userId: string): Promise<ProfileRow> {
  await env.DB.prepare(`
    INSERT INTO learner_profiles (user_id) VALUES (?)
    ON CONFLICT(user_id) DO NOTHING
  `).bind(userId).run();
  const profile = await env.DB.prepare(`
    SELECT user_id, reward_points, current_streak, longest_streak, last_checkin_date, updated_at
    FROM learner_profiles
    WHERE user_id = ?
  `).bind(userId).first<ProfileRow>();
  if (!profile) throw new Error('Learner profile could not be created');
  return profile;
}

export async function handleListPublishedPassages(request: Request, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const difficultyMin = parseOptionalSafeInteger(url.searchParams.get('difficulty_min'), 'difficulty_min', origin);
  if (isResponse(difficultyMin)) return difficultyMin;
  const difficultyMax = parseOptionalSafeInteger(url.searchParams.get('difficulty_max'), 'difficulty_max', origin);
  if (isResponse(difficultyMax)) return difficultyMax;
  if (difficultyMin !== null && difficultyMax !== null && difficultyMin > difficultyMax) {
    return errorResponse(400, 'VALIDATION_ERROR', 'difficulty_min không được lớn hơn difficulty_max', origin);
  }
  const termIds = [...new Set(url.searchParams.getAll('term_id').map(id => id.trim()).filter(Boolean))];
  if (termIds.length > 20) return errorResponse(400, 'VALIDATION_ERROR', 'Chỉ được lọc tối đa 20 term_id', origin);
  const text = url.searchParams.get('text')?.trim().toLowerCase() ?? '';
  const { page, size, offset } = parsePagination(url);
  const conditions = ['1 = 1'];
  const params: Array<string | number> = [];
  if (text) {
    conditions.push('(LOWER(title.text) LIKE ? OR LOWER(COALESCE(passage.summary, \'\')) LIKE ?)');
    params.push(`%${text}%`, `%${text}%`);
  }
  if (difficultyMin !== null) {
    conditions.push('passage.difficulty >= ?');
    params.push(difficultyMin);
  }
  if (difficultyMax !== null) {
    conditions.push('passage.difficulty <= ?');
    params.push(difficultyMax);
  }
  if (termIds.length > 0) {
    const placeholders = termIds.map(() => '?').join(', ');
    conditions.push(`passage.id IN (
      SELECT passage_id
      FROM passage_terms
      WHERE term_id IN (${placeholders})
      GROUP BY passage_id
      HAVING COUNT(DISTINCT term_id) = ?
    )`);
    params.push(...termIds, termIds.length);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  try {
    const [count, rows] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM passages passage
        JOIN sentences title ON title.id = passage.title_sentence_id
        JOIN passages_runtime runtime ON runtime.passage_id = passage.id
        ${where}
      `).bind(...params).first<{ total: number }>(),
      env.DB.prepare(`
        SELECT
          passage.id,
          title.text AS title,
          title.translations AS title_translations,
          passage.image,
          passage.summary,
          passage.difficulty,
          passage.reward_points,
          runtime.updated_at AS runtime_updated_at
        FROM passages passage
        JOIN sentences title ON title.id = passage.title_sentence_id
        JOIN passages_runtime runtime ON runtime.passage_id = passage.id
        ${where}
        ORDER BY passage.difficulty ASC, title.text ASC, passage.id ASC
        LIMIT ? OFFSET ?
      `).bind(...params, size, offset).all<LibraryPassageRow>(),
    ]);
    const passageIds = rows.results.map(row => row.id);
    const termsByPassage = new Map<string, TermRow[]>();
    if (passageIds.length > 0) {
      const placeholders = passageIds.map(() => '?').join(', ');
      const terms = await env.DB.prepare(`
        SELECT
          assigned.passage_id,
          term.id,
          term.code,
          term.name,
          term.description,
          term.translations,
          taxonomy.id AS taxonomy_id,
          taxonomy.code AS taxonomy_code,
          taxonomy.name AS taxonomy_name,
          taxonomy.description AS taxonomy_description,
          taxonomy.translations AS taxonomy_translations
        FROM passage_terms assigned
        JOIN taxonomy_terms term ON term.id = assigned.term_id
        JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
        WHERE assigned.passage_id IN (${placeholders})
        ORDER BY taxonomy.name ASC, term.position ASC
      `).bind(...passageIds).all<TermRow>();
      for (const term of terms.results) {
        const values = termsByPassage.get(term.passage_id) ?? [];
        values.push(term);
        termsByPassage.set(term.passage_id, values);
      }
    }
    return successResponse(200, 'SUCCESS', rows.results.map(row => ({
      ...row,
      title_translations: parseJson(row.title_translations, null),
      terms: (termsByPassage.get(row.id) ?? []).map(term => ({
        id: term.id,
        code: term.code,
        name: term.name,
        description: term.description,
        translations: parseJson(term.translations, {}),
        taxonomy: {
          id: term.taxonomy_id,
          code: term.taxonomy_code,
          name: term.taxonomy_name,
          description: term.taxonomy_description,
          translations: parseJson(term.taxonomy_translations, {}),
        },
      })),
    })), origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetPublishedPassage(env: Env, origin: string, passageId: string): Promise<Response> {
  try {
    const row = await getRuntime(env, passageId);
    if (!row) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const runtime = parseRuntime(row);
    if (!runtime) return errorResponse(500, 'INTERNAL_ERROR', 'Passage runtime không hợp lệ', origin);
    return successResponse(200, 'SUCCESS', { ...(runtime.payload as object), updated_at: runtime.updated_at }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListPublishedRoadmaps(request: Request, env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const { page, size, offset } = parsePagination(new URL(request.url));
    const [count, rows] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS total FROM roadmaps WHERE published_at IS NOT NULL AND archived_at IS NULL
      `).first<{ total: number }>(),
      env.DB.prepare(`
        SELECT
          roadmap.id,
          roadmap.name,
          roadmap.description,
          roadmap.image,
          roadmap.published_at,
          COUNT(runtime.passage_id) AS passage_count,
          COUNT(CASE WHEN reading.completed_at IS NOT NULL THEN 1 END) AS completed_count
        FROM roadmaps roadmap
        LEFT JOIN roadmap_passages mapping ON mapping.roadmap_id = roadmap.id
        LEFT JOIN passages_runtime runtime ON runtime.passage_id = mapping.passage_id
        LEFT JOIN learner_passages reading
          ON reading.passage_id = mapping.passage_id
         AND reading.user_id = ?
        WHERE roadmap.published_at IS NOT NULL AND roadmap.archived_at IS NULL
        GROUP BY roadmap.id
        ORDER BY roadmap.published_at DESC, roadmap.id ASC
        LIMIT ? OFFSET ?
      `).bind(userId, size, offset).all<{
        id: string;
        name: string;
        description: string | null;
        image: string | null;
        published_at: number;
        passage_count: number;
        completed_count: number;
      }>(),
    ]);
    return successResponse(200, 'SUCCESS', rows.results, origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetPublishedRoadmap(env: Env, origin: string, userId: string, roadmapId: string): Promise<Response> {
  try {
    const roadmap = await env.DB.prepare(`
      SELECT id, name, description, image, published_at
      FROM roadmaps
      WHERE id = ? AND published_at IS NOT NULL AND archived_at IS NULL
    `).bind(roadmapId).first<{
      id: string;
      name: string;
      description: string | null;
      image: string | null;
      published_at: number;
    }>();
    if (!roadmap) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const passages = await env.DB.prepare(`
      SELECT
        mapping.id AS roadmap_passage_id,
        mapping.position,
        passage.id,
        title.text AS title,
        passage.image,
        passage.summary,
        passage.difficulty,
        passage.reward_points,
        reading.id AS learner_passage_id,
        reading.first_started_at,
        reading.last_studied_at,
        reading.completed_at,
        reading.reward_points_awarded
      FROM roadmap_passages mapping
      JOIN passages passage ON passage.id = mapping.passage_id
      JOIN sentences title ON title.id = passage.title_sentence_id
      JOIN passages_runtime runtime ON runtime.passage_id = passage.id
      LEFT JOIN learner_passages reading
        ON reading.passage_id = passage.id
       AND reading.user_id = ?
      WHERE mapping.roadmap_id = ?
      ORDER BY mapping.position ASC, mapping.id ASC
    `).bind(userId, roadmapId).all<{
      roadmap_passage_id: string;
      position: number;
      id: string;
      title: string;
      image: string | null;
      summary: string | null;
      difficulty: number | null;
      reward_points: number;
      learner_passage_id: string | null;
      first_started_at: number | null;
      last_studied_at: number | null;
      completed_at: number | null;
      reward_points_awarded: number | null;
    }>();
    return successResponse(200, 'SUCCESS', { ...roadmap, passages: passages.results }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetLearnerPassageProgress(
  env: Env,
  origin: string,
  userId: string,
  passageId: string,
): Promise<Response> {
  try {
    const reading = await getLearnerPassage(env, userId, passageId);
    return successResponse(200, 'SUCCESS', reading ? presentLearnerPassage(reading) : null, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateLearnerPassageProgress(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
  passageId: string,
): Promise<Response> {
  const progress = await readProgressSnapshot(request, origin);
  if (isResponse(progress)) return progress;
  try {
    if (!await passageExists(env, passageId)) return errorResponse(404, 'NOT_FOUND', 'Passage không tồn tại', origin);
    await saveProgressSnapshot(env, userId, passageId, progress);
    const reading = await getLearnerPassage(env, userId, passageId);
    return successResponse(200, 'UPDATED', reading ? presentLearnerPassage(reading) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCompleteLearnerPassage(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
  passageId: string,
): Promise<Response> {
  const progress = await readProgressSnapshot(request, origin);
  if (isResponse(progress)) return progress;
  try {
    if (!await getRuntime(env, passageId)) return errorResponse(404, 'NOT_FOUND', 'Passage chưa được publish', origin);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO learner_passages (id, user_id, passage_id, progress, first_started_at, last_studied_at)
        VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
        ON CONFLICT(user_id, passage_id) DO UPDATE SET
          progress = excluded.progress,
          last_studied_at = unixepoch()
      `).bind(generateUUIDv7(), userId, passageId, JSON.stringify(progress)),
      env.DB.prepare(`
        UPDATE learner_passages
        SET
          completed_at = unixepoch(),
          reward_points_awarded = (SELECT reward_points FROM passages WHERE id = ?)
        WHERE user_id = ? AND passage_id = ? AND completed_at IS NULL
      `).bind(passageId, userId, passageId),
    ]);
    const [reading, profile] = await Promise.all([
      getLearnerPassage(env, userId, passageId),
      ensureProfile(env, userId),
    ]);
    return successResponse(200, 'UPDATED', {
      reading: reading ? presentLearnerPassage(reading) : null,
      awarded_points: reading?.reward_points_awarded ?? 0,
      profile,
    }, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListLearnerPassages(request: Request, env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') ?? 'recent';
    if (scope !== 'recent' && scope !== 'completed') {
      return errorResponse(400, 'VALIDATION_ERROR', 'scope phải là recent hoặc completed', origin);
    }
    const { page, size, offset } = parsePagination(url);
    const completionCondition = scope === 'completed' ? 'AND reading.completed_at IS NOT NULL' : '';
    const orderBy = scope === 'completed' ? 'reading.completed_at DESC' : 'reading.last_studied_at DESC';
    const [count, rows] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS total FROM learner_passages reading
        WHERE reading.user_id = ? ${completionCondition}
      `).bind(userId).first<{ total: number }>(),
      env.DB.prepare(`
        SELECT
          reading.id, reading.passage_id, reading.progress, reading.first_started_at,
          reading.last_studied_at, reading.completed_at, reading.reward_points_awarded,
          title.text AS title, passage.image, passage.summary, passage.difficulty
        FROM learner_passages reading
        JOIN passages passage ON passage.id = reading.passage_id
        JOIN sentences title ON title.id = passage.title_sentence_id
        WHERE reading.user_id = ? ${completionCondition}
        ORDER BY ${orderBy}, reading.id ASC
        LIMIT ? OFFSET ?
      `).bind(userId, size, offset).all<LearnerPassageRow & {
        title: string;
        image: string | null;
        summary: string | null;
        difficulty: number | null;
      }>(),
    ]);
    return successResponse(200, 'SUCCESS', rows.results.map(row => ({
      ...presentLearnerPassage(row),
      title: row.title,
      image: row.image,
      summary: row.summary,
      difficulty: row.difficulty,
    })), origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetReadingSummary(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const profile = await ensureProfile(env, userId);
    const [reading, recent, lexicalReview] = await Promise.all([
      env.DB.prepare(`
        SELECT
          COUNT(*) AS completed_passages,
          COALESCE(SUM(reward_points_awarded), 0) AS passage_points
        FROM learner_passages
        WHERE user_id = ? AND completed_at IS NOT NULL
      `).bind(userId).first<{ completed_passages: number; passage_points: number }>(),
      env.DB.prepare(`
        SELECT
          reading.id,
          reading.passage_id,
          title.text AS title,
          reading.completed_at,
          reading.reward_points_awarded
        FROM learner_passages reading
        JOIN passages passage ON passage.id = reading.passage_id
        JOIN sentences title ON title.id = passage.title_sentence_id
        WHERE reading.user_id = ? AND reading.completed_at IS NOT NULL
        ORDER BY reading.completed_at DESC
        LIMIT 10
      `).bind(userId).all<{
        id: string;
        passage_id: string;
        title: string;
        completed_at: number;
        reward_points_awarded: number;
      }>(),
      env.DB.prepare(`
        SELECT
          COUNT(*) AS saved_lexicals,
          COUNT(last_reviewed_at) AS reviewed_lexicals,
          AVG(meaning_score) AS average_meaning_score,
          AVG(pronunciation_score) AS average_pronunciation_score,
          AVG(review_score) AS average_review_score
        FROM learner_lexicals
        WHERE user_id = ?
      `).bind(userId).first<{
        saved_lexicals: number;
        reviewed_lexicals: number;
        average_meaning_score: number | null;
        average_pronunciation_score: number | null;
        average_review_score: number | null;
      }>(),
    ]);
    return successResponse(200, 'SUCCESS', {
      profile,
      completed_passages: reading?.completed_passages ?? 0,
      passage_points: reading?.passage_points ?? 0,
      lexical_review: lexicalReview ?? {
        saved_lexicals: 0,
        reviewed_lexicals: 0,
        average_meaning_score: null,
        average_pronunciation_score: null,
        average_review_score: null,
      },
      recent_completions: recent.results,
    }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetLearnerProfile(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    return successResponse(200, 'SUCCESS', await ensureProfile(env, userId), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCheckIn(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    await env.DB.prepare(`
      INSERT INTO learner_profiles (
        user_id,
        current_streak,
        longest_streak,
        last_checkin_date,
        updated_at
      ) VALUES (?, 1, 1, date('now', '+7 hours'), unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET
        current_streak = CASE
          WHEN learner_profiles.last_checkin_date = date('now', '+7 hours') THEN learner_profiles.current_streak
          WHEN learner_profiles.last_checkin_date = date('now', '+7 hours', '-1 day') THEN learner_profiles.current_streak + 1
          ELSE 1
        END,
        longest_streak = MAX(
          learner_profiles.longest_streak,
          CASE
            WHEN learner_profiles.last_checkin_date = date('now', '+7 hours') THEN learner_profiles.current_streak
            WHEN learner_profiles.last_checkin_date = date('now', '+7 hours', '-1 day') THEN learner_profiles.current_streak + 1
            ELSE 1
          END
        ),
        last_checkin_date = date('now', '+7 hours'),
        updated_at = unixepoch()
    `).bind(userId).run();
    return successResponse(200, 'UPDATED', await ensureProfile(env, userId), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
