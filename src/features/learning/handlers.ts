import { parseOptionalMediaUrl } from '../../utils/media';
import { parsePagination } from '../../utils/pagination';
import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';
import { buildPassageDetail } from '../passages/handlers';

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
}

interface LearnerPassageRow {
  id: string;
  user_id: string;
  passage_id: string;
  mode: 'fixed' | 'flexible';
  roadmap_passage_id: string | null;
  started_at: number;
  completed_at: number | null;
  reward_points_awarded: number | null;
}

interface ActivityProgressRow {
  learner_passage_id: string;
  passage_activity_id: string;
  code: string;
  name: string;
  position: number;
  config: string;
  is_enabled: number;
  status: string | null;
  score: number | null;
  result: string | null;
  audio: string | null;
  completed_at: number | null;
  updated_at: number | null;
}

interface ProfileRow {
  user_id: string;
  reward_points: number;
  current_streak: number;
  longest_streak: number;
  last_checkin_date: string | null;
  updated_at: number;
}

interface ActivityInput {
  status: string;
  score: number | null;
  result: unknown | null;
  audio: string | null;
}

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

async function getActive(env: Env, userId: string): Promise<LearnerPassageRow | null> {
  return env.DB.prepare(`
    SELECT id, user_id, passage_id, mode, roadmap_passage_id, started_at, completed_at, reward_points_awarded
    FROM learner_passages
    WHERE user_id = ? AND completed_at IS NULL
  `).bind(userId).first<LearnerPassageRow>();
}

async function getProgress(env: Env, learnerPassageId: string): Promise<ActivityProgressRow[]> {
  const rows = await env.DB.prepare(`
    SELECT
      ? AS learner_passage_id,
      activity.id AS passage_activity_id,
      activity.code,
      activity.name,
      activity.position,
      activity.config,
      activity.is_enabled,
      progress.status,
      progress.score,
      progress.result,
      progress.audio,
      progress.completed_at,
      progress.updated_at
    FROM learner_passages reading
    JOIN passage_activities activity ON activity.passage_id = reading.passage_id
    LEFT JOIN learner_activity_progress progress
      ON progress.learner_passage_id = reading.id
     AND progress.passage_activity_id = activity.id
    WHERE reading.id = ?
    ORDER BY activity.position ASC, activity.id ASC
  `).bind(learnerPassageId, learnerPassageId).all<ActivityProgressRow>();
  return rows.results;
}

function parseProgress(row: ActivityProgressRow) {
  return {
    learner_passage_id: row.learner_passage_id,
    passage_activity_id: row.passage_activity_id,
    code: row.code,
    name: row.name,
    position: row.position,
    config: parseJson(row.config, {}),
    is_enabled: row.is_enabled === 1,
    status: row.status ?? 'not_started',
    score: row.score,
    result: parseJson(row.result, null),
    audio: row.audio,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}

async function getReadingDetail(env: Env, reading: LearnerPassageRow) {
  const [runtimeRow, progress] = await Promise.all([
    getRuntime(env, reading.passage_id),
    getProgress(env, reading.id),
  ]);
  const runtime = runtimeRow ? parseRuntime(runtimeRow) : null;
  const passage = runtime?.payload ?? await buildPassageDetail(env, reading.passage_id);
  return {
    ...reading,
    passage,
    runtime_updated_at: runtime?.updated_at ?? null,
    activities: progress.map(parseProgress),
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
          taxonomy.name AS taxonomy_name
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
        taxonomy: { id: term.taxonomy_id, code: term.taxonomy_code, name: term.taxonomy_name },
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
        reading.mode,
        reading.started_at,
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
      mode: 'fixed' | 'flexible' | null;
      started_at: number | null;
      completed_at: number | null;
      reward_points_awarded: number | null;
    }>();
    return successResponse(200, 'SUCCESS', { ...roadmap, passages: passages.results }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetActiveReading(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const reading = await getActive(env, userId);
    return successResponse(200, 'SUCCESS', reading ? await getReadingDetail(env, reading) : null, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleStartReading(request: Request, env: Env, origin: string, userId: string): Promise<Response> {
  const body = await readObject(request, origin);
  if (isResponse(body)) return body;
  const passageId = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
  if (!passageId) return errorResponse(400, 'VALIDATION_ERROR', 'passage_id không được để trống', origin);
  if (body.mode !== 'fixed' && body.mode !== 'flexible') {
    return errorResponse(400, 'VALIDATION_ERROR', 'mode phải là fixed hoặc flexible', origin);
  }
  const roadmapPassageId = body.mode === 'fixed' && typeof body.roadmap_passage_id === 'string'
    ? body.roadmap_passage_id.trim()
    : null;
  if (body.mode === 'fixed' && !roadmapPassageId) {
    return errorResponse(400, 'VALIDATION_ERROR', 'roadmap_passage_id là bắt buộc ở fixed mode', origin);
  }
  if (body.mode === 'flexible' && body.roadmap_passage_id !== undefined && body.roadmap_passage_id !== null) {
    return errorResponse(400, 'VALIDATION_ERROR', 'flexible mode không sử dụng roadmap_passage_id', origin);
  }
  try {
    const active = await getActive(env, userId);
    if (active) {
      if (active.passage_id === passageId) {
        return successResponse(200, 'SUCCESS', await getReadingDetail(env, active), origin);
      }
      return errorResponse(409, 'CONFLICT', {
        reason: 'ACTIVE_PASSAGE_EXISTS',
        active: await getReadingDetail(env, active),
      }, origin);
    }
    const completed = await env.DB.prepare(`
      SELECT id FROM learner_passages WHERE user_id = ? AND passage_id = ?
    `).bind(userId, passageId).first<{ id: string }>();
    if (completed) return errorResponse(409, 'CONFLICT', 'Passage này đã hoàn thành và nằm trong lịch sử', origin);
    if (!await getRuntime(env, passageId)) return errorResponse(404, 'NOT_FOUND', 'Passage chưa được publish', origin);
    if (body.mode === 'fixed') {
      const mapping = await env.DB.prepare(`
        SELECT mapping.id
        FROM roadmap_passages mapping
        JOIN roadmaps roadmap ON roadmap.id = mapping.roadmap_id
        WHERE mapping.id = ?
          AND mapping.passage_id = ?
          AND roadmap.published_at IS NOT NULL
          AND roadmap.archived_at IS NULL
      `).bind(roadmapPassageId, passageId).first<{ id: string }>();
      if (!mapping) return errorResponse(409, 'CONFLICT', 'Passage không thuộc roadmap đang được publish', origin);
    }
    const id = generateUUIDv7();
    await env.DB.prepare(`
      INSERT INTO learner_passages (id, user_id, passage_id, mode, roadmap_passage_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, userId, passageId, body.mode, roadmapPassageId).run();
    const reading = await getActive(env, userId);
    return successResponse(201, 'CREATED', reading ? await getReadingDetail(env, reading) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleAbandonActiveReading(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const result = await env.DB.prepare(`
      DELETE FROM learner_passages WHERE user_id = ? AND completed_at IS NULL
    `).bind(userId).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', 'Không có passage đang active', origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

async function readActivityInput(request: Request, origin: string): Promise<ActivityInput | Response> {
  const body = await readObject(request, origin);
  if (isResponse(body)) return body;
  const status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!status || status.length > 50) return errorResponse(400, 'VALIDATION_ERROR', 'status phải dài từ 1 đến 50 ký tự', origin);
  const score = body.score === undefined || body.score === null ? null : body.score;
  if (score !== null && (typeof score !== 'number' || !Number.isFinite(score))) {
    return errorResponse(400, 'VALIDATION_ERROR', 'score phải là số hữu hạn hoặc null', origin);
  }
  const result = body.result === undefined ? null : body.result;
  try {
    JSON.stringify(result);
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'result không thể chuyển thành JSON', origin);
  }
  const audio = parseOptionalMediaUrl(body.audio, 'audio', origin);
  if (isResponse(audio)) return audio;
  return { status, score: score as number | null, result, audio: audio ?? null };
}

export async function handleUpdateActiveReadingActivity(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
  activityId: string,
): Promise<Response> {
  const input = await readActivityInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const active = await getActive(env, userId);
    if (!active) return errorResponse(404, 'NOT_FOUND', 'Không có passage đang active', origin);
    const activity = await env.DB.prepare(`
      SELECT id FROM passage_activities WHERE id = ? AND passage_id = ?
    `).bind(activityId, active.passage_id).first<{ id: string }>();
    if (!activity) return errorResponse(404, 'NOT_FOUND', 'Activity không thuộc passage đang active', origin);
    const completedAt = input.status === 'completed' ? Math.floor(Date.now() / 1000) : null;
    await env.DB.prepare(`
      INSERT INTO learner_activity_progress (
        learner_passage_id,
        passage_activity_id,
        status,
        score,
        result,
        audio,
        completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(learner_passage_id, passage_activity_id) DO UPDATE SET
        status = excluded.status,
        score = excluded.score,
        result = excluded.result,
        audio = excluded.audio,
        completed_at = excluded.completed_at,
        updated_at = unixepoch()
    `).bind(
      active.id,
      activityId,
      input.status,
      input.score,
      JSON.stringify(input.result),
      input.audio,
      completedAt,
    ).run();
    const progress = await getProgress(env, active.id);
    const updated = progress.find(row => row.passage_activity_id === activityId);
    return successResponse(200, 'UPDATED', updated ? parseProgress(updated) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCompleteActiveReading(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const result = await env.DB.prepare(`
      UPDATE learner_passages
      SET
        completed_at = unixepoch(),
        reward_points_awarded = (
          SELECT reward_points FROM passages WHERE passages.id = learner_passages.passage_id
        )
      WHERE user_id = ? AND completed_at IS NULL
    `).bind(userId).run();
    if (!result.meta.changes) return errorResponse(409, 'CONFLICT', 'Không có passage active để hoàn thành', origin);
    const [reading, profile] = await Promise.all([
      env.DB.prepare(`
        SELECT id, user_id, passage_id, mode, roadmap_passage_id, started_at, completed_at, reward_points_awarded
        FROM learner_passages
        WHERE user_id = ?
        ORDER BY completed_at DESC
        LIMIT 1
      `).bind(userId).first<LearnerPassageRow>(),
      ensureProfile(env, userId),
    ]);
    return successResponse(200, 'UPDATED', {
      reading,
      awarded_points: reading?.reward_points_awarded ?? 0,
      profile,
    }, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListReadingHistory(request: Request, env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const { page, size, offset } = parsePagination(new URL(request.url));
    const [count, rows] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS total FROM learner_passages WHERE user_id = ? AND completed_at IS NOT NULL
      `).bind(userId).first<{ total: number }>(),
      env.DB.prepare(`
        SELECT
          reading.id,
          reading.passage_id,
          reading.mode,
          reading.roadmap_passage_id,
          reading.started_at,
          reading.completed_at,
          reading.reward_points_awarded,
          title.text AS title,
          passage.image,
          passage.summary,
          passage.difficulty
        FROM learner_passages reading
        JOIN passages passage ON passage.id = reading.passage_id
        JOIN sentences title ON title.id = passage.title_sentence_id
        WHERE reading.user_id = ? AND reading.completed_at IS NOT NULL
        ORDER BY reading.completed_at DESC, reading.id ASC
        LIMIT ? OFFSET ?
      `).bind(userId, size, offset).all<{
        id: string;
        passage_id: string;
        mode: 'fixed' | 'flexible';
        roadmap_passage_id: string | null;
        started_at: number;
        completed_at: number;
        reward_points_awarded: number;
        title: string;
        image: string | null;
        summary: string | null;
        difficulty: number | null;
      }>(),
    ]);
    return successResponse(200, 'SUCCESS', rows.results, origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetReadingHistoryItem(env: Env, origin: string, userId: string, readingId: string): Promise<Response> {
  try {
    const reading = await env.DB.prepare(`
      SELECT id, user_id, passage_id, mode, roadmap_passage_id, started_at, completed_at, reward_points_awarded
      FROM learner_passages
      WHERE id = ? AND user_id = ? AND completed_at IS NOT NULL
    `).bind(readingId, userId).first<LearnerPassageRow>();
    if (!reading) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', await getReadingDetail(env, reading), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetReadingSummary(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const profile = await ensureProfile(env, userId);
    const [reading, activities, recent] = await Promise.all([
      env.DB.prepare(`
        SELECT
          COUNT(*) AS completed_passages,
          COALESCE(SUM(reward_points_awarded), 0) AS passage_points
        FROM learner_passages
        WHERE user_id = ? AND completed_at IS NOT NULL
      `).bind(userId).first<{ completed_passages: number; passage_points: number }>(),
      env.DB.prepare(`
        SELECT
          activity.code,
          COUNT(progress.score) AS scored_attempts,
          AVG(progress.score) AS average_score,
          MAX(progress.updated_at) AS last_updated_at
        FROM learner_activity_progress progress
        JOIN learner_passages learner_passage ON learner_passage.id = progress.learner_passage_id
        JOIN passage_activities activity ON activity.id = progress.passage_activity_id
        WHERE learner_passage.user_id = ?
        GROUP BY activity.code
        ORDER BY activity.code ASC
      `).bind(userId).all<{
        code: string;
        scored_attempts: number;
        average_score: number | null;
        last_updated_at: number;
      }>(),
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
    ]);
    return successResponse(200, 'SUCCESS', {
      profile,
      completed_passages: reading?.completed_passages ?? 0,
      passage_points: reading?.passage_points ?? 0,
      activity_results: activities.results,
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
      ) VALUES (?, 1, 1, date('now'), unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET
        current_streak = CASE
          WHEN learner_profiles.last_checkin_date = date('now') THEN learner_profiles.current_streak
          WHEN learner_profiles.last_checkin_date = date('now', '-1 day') THEN learner_profiles.current_streak + 1
          ELSE 1
        END,
        longest_streak = MAX(
          learner_profiles.longest_streak,
          CASE
            WHEN learner_profiles.last_checkin_date = date('now') THEN learner_profiles.current_streak
            WHEN learner_profiles.last_checkin_date = date('now', '-1 day') THEN learner_profiles.current_streak + 1
            ELSE 1
          END
        ),
        last_checkin_date = date('now'),
        updated_at = unixepoch()
    `).bind(userId).run();
    return successResponse(200, 'UPDATED', await ensureProfile(env, userId), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
