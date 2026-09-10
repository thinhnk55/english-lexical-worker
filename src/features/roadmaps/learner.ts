import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';

const FLEXIBLE_ROADMAP_NAME = 'Lộ trình linh hoạt';
const TEMPORARY_POSITION_OFFSET = 1_000_000;

interface LearnerRoadmapRow {
  id: string;
  user_id: string;
  roadmap_id: string | null;
  kind: 'curated' | 'flexible';
  created_at: number;
  updated_at: number;
  name: string | null;
  description: string | null;
  image: string | null;
}

interface LearnerRoadmapPassageRow {
  id: string;
  position: number;
  title: string;
  image: string | null;
  summary: string | null;
  difficulty: number | null;
  reward_points: number;
  first_started_at: number | null;
  last_studied_at: number | null;
  completed_at: number | null;
  reward_points_awarded: number | null;
}

interface PassageInput {
  passage_id: string;
  position?: number;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint|unique|foreign key/i.test(error.message);
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

async function readPassageInput(request: Request, origin: string): Promise<PassageInput | Response> {
  const body = await readObject(request, origin);
  if (isResponse(body)) return body;
  const passageId = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
  if (!passageId) return errorResponse(400, 'VALIDATION_ERROR', 'passage_id không được để trống', origin);
  const position = body.position;
  if (position !== undefined && (!Number.isSafeInteger(position) || (position as number) < 0)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
  }
  return { passage_id: passageId, ...(position === undefined ? {} : { position: position as number }) };
}

async function getLearnerRoadmap(env: Env, userId: string, id: string): Promise<LearnerRoadmapRow | null> {
  return env.DB.prepare(`
    SELECT
      learner.id,
      learner.user_id,
      learner.roadmap_id,
      learner.kind,
      learner.created_at,
      learner.updated_at,
      roadmap.name,
      roadmap.description,
      roadmap.image
    FROM learner_roadmaps learner
    LEFT JOIN roadmaps roadmap ON roadmap.id = learner.roadmap_id
    WHERE learner.id = ? AND learner.user_id = ?
  `).bind(id, userId).first<LearnerRoadmapRow>();
}

async function listLearnerRoadmaps(env: Env, userId: string): Promise<LearnerRoadmapRow[]> {
  const rows = await env.DB.prepare(`
    SELECT
      learner.id,
      learner.user_id,
      learner.roadmap_id,
      learner.kind,
      learner.created_at,
      learner.updated_at,
      roadmap.name,
      roadmap.description,
      roadmap.image
    FROM learner_roadmaps learner
    LEFT JOIN roadmaps roadmap ON roadmap.id = learner.roadmap_id
    WHERE learner.user_id = ?
    ORDER BY learner.updated_at DESC, learner.id ASC
  `).bind(userId).all<LearnerRoadmapRow>();
  return rows.results;
}

async function listPassages(
  env: Env,
  userId: string,
  roadmap: LearnerRoadmapRow,
): Promise<LearnerRoadmapPassageRow[]> {
  const source = roadmap.kind === 'curated'
    ? {
      table: 'roadmap_passages mapping',
      id: 'mapping.passage_id',
      where: 'mapping.roadmap_id = ?',
      parameter: roadmap.roadmap_id,
    }
    : {
      table: 'learner_roadmap_passages mapping',
      id: 'mapping.passage_id',
      where: 'mapping.learner_roadmap_id = ?',
      parameter: roadmap.id,
    };
  const rows = await env.DB.prepare(`
    SELECT
      ${source.id} AS id,
      mapping.position,
      title.text AS title,
      passage.image,
      passage.summary,
      passage.difficulty,
      passage.reward_points,
      reading.first_started_at,
      reading.last_studied_at,
      reading.completed_at,
      reading.reward_points_awarded
    FROM ${source.table}
    JOIN passages passage ON passage.id = ${source.id}
    JOIN passages_runtime runtime ON runtime.passage_id = passage.id
    JOIN sentences title ON title.id = passage.title_sentence_id
    LEFT JOIN learner_passages reading
      ON reading.passage_id = passage.id
     AND reading.user_id = ?
    WHERE ${source.where}
    ORDER BY mapping.position ASC, mapping.id ASC
  `).bind(userId, source.parameter).all<LearnerRoadmapPassageRow>();
  return rows.results;
}

function presentRoadmap(
  roadmap: LearnerRoadmapRow,
  passages: LearnerRoadmapPassageRow[],
  includePassages = true,
) {
  const currentIndex = passages.findIndex(passage => passage.completed_at === null);
  const completedCount = passages.filter(passage => passage.completed_at !== null).length;
  return {
    id: roadmap.id,
    roadmap_id: roadmap.roadmap_id,
    kind: roadmap.kind,
    name: roadmap.name ?? FLEXIBLE_ROADMAP_NAME,
    description: roadmap.description,
    image: roadmap.image,
    created_at: roadmap.created_at,
    updated_at: roadmap.updated_at,
    current_passage: currentIndex === -1 ? null : passages[currentIndex],
    next_passage: currentIndex === -1
      ? null
      : passages.slice(currentIndex + 1).find(passage => passage.completed_at === null) ?? null,
    completed_count: completedCount,
    total_count: passages.length,
    is_completed: passages.length > 0 && completedCount === passages.length,
    ...(includePassages ? { passages } : {}),
  };
}

async function roadmapPassageIds(env: Env, learnerRoadmapId: string): Promise<string[]> {
  const rows = await env.DB.prepare(`
    SELECT id FROM learner_roadmap_passages
    WHERE learner_roadmap_id = ?
    ORDER BY position ASC, id ASC
  `).bind(learnerRoadmapId).all<{ id: string }>();
  return rows.results.map(row => row.id);
}

function insertAt(ids: string[], id: string, position: number): string[] {
  return [...ids.slice(0, position), id, ...ids.slice(position)];
}

function reorderStatements(env: Env, learnerRoadmapId: string, ids: string[]): D1PreparedStatement[] {
  if (ids.length === 0) return [];
  return [
    env.DB.prepare(`
      UPDATE learner_roadmap_passages
      SET position = position + ${TEMPORARY_POSITION_OFFSET}
      WHERE learner_roadmap_id = ?
    `).bind(learnerRoadmapId),
    ...ids.map((id, position) => (
      env.DB.prepare('UPDATE learner_roadmap_passages SET position = ? WHERE id = ?').bind(position, id)
    )),
  ];
}

async function requireFlexibleRoadmap(env: Env, userId: string, origin: string, id: string): Promise<LearnerRoadmapRow | Response> {
  const roadmap = await getLearnerRoadmap(env, userId, id);
  if (!roadmap) return errorResponse(404, 'NOT_FOUND', 'Roadmap chưa được chọn', origin);
  if (roadmap.kind !== 'flexible') {
    return errorResponse(409, 'CONFLICT', 'Chỉ roadmap linh hoạt mới có thể thay đổi danh sách bài học', origin);
  }
  return roadmap;
}

export async function handleListLearnerRoadmaps(env: Env, origin: string, userId: string): Promise<Response> {
  try {
    const roadmaps = await listLearnerRoadmaps(env, userId);
    const results = await Promise.all(roadmaps.map(async roadmap => (
      presentRoadmap(roadmap, await listPassages(env, userId, roadmap), false)
    )));
    return successResponse(200, 'SUCCESS', results, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetLearnerRoadmap(
  env: Env,
  origin: string,
  userId: string,
  id: string,
): Promise<Response> {
  try {
    const roadmap = await getLearnerRoadmap(env, userId, id);
    if (!roadmap) return errorResponse(404, 'NOT_FOUND', 'Roadmap chưa được chọn', origin);
    return successResponse(200, 'SUCCESS', presentRoadmap(roadmap, await listPassages(env, userId, roadmap)), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleSelectLearnerRoadmap(request: Request, env: Env, origin: string, userId: string): Promise<Response> {
  const body = await readObject(request, origin);
  if (isResponse(body)) return body;
  const roadmapId = typeof body.roadmap_id === 'string' ? body.roadmap_id.trim() : '';
  const type = body.type;
  const isFlexible = type === 'flexible' && !roadmapId;
  if (!isFlexible && !roadmapId) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Cần roadmap_id hoặc type: flexible', origin);
  }
  if (!isFlexible && type !== undefined) {
    return errorResponse(400, 'VALIDATION_ERROR', 'type chỉ nhận giá trị flexible', origin);
  }
  try {
    if (isFlexible) {
      await env.DB.prepare(`
        INSERT INTO learner_roadmaps (id, user_id, roadmap_id, kind)
        VALUES (?, ?, NULL, 'flexible')
        ON CONFLICT DO NOTHING
      `).bind(generateUUIDv7(), userId).run();
      const flexible = await env.DB.prepare(`
        SELECT id FROM learner_roadmaps WHERE user_id = ? AND kind = 'flexible'
      `).bind(userId).first<{ id: string }>();
      if (!flexible) throw new Error('Flexible roadmap could not be created');
      return handleGetLearnerRoadmap(env, origin, userId, flexible.id);
    }

    const roadmap = await env.DB.prepare(`
      SELECT id FROM roadmaps
      WHERE id = ? AND published_at IS NOT NULL AND archived_at IS NULL
    `).bind(roadmapId).first<{ id: string }>();
    if (!roadmap) return errorResponse(404, 'NOT_FOUND', 'Roadmap chưa được publish', origin);
    await env.DB.prepare(`
      INSERT INTO learner_roadmaps (id, user_id, roadmap_id, kind)
      VALUES (?, ?, ?, 'curated')
      ON CONFLICT(user_id, roadmap_id) DO UPDATE SET updated_at = unixepoch()
    `).bind(generateUUIDv7(), userId, roadmapId).run();
    const selected = await env.DB.prepare(`
      SELECT id FROM learner_roadmaps WHERE user_id = ? AND roadmap_id = ?
    `).bind(userId, roadmapId).first<{ id: string }>();
    if (!selected) throw new Error('Learner roadmap could not be selected');
    return handleGetLearnerRoadmap(env, origin, userId, selected.id);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleAddLearnerRoadmapPassage(
  request: Request,
  env: Env,
  origin: string,
  userId: string,
  learnerRoadmapId: string,
): Promise<Response> {
  const input = await readPassageInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const roadmap = await requireFlexibleRoadmap(env, userId, origin, learnerRoadmapId);
    if (isResponse(roadmap)) return roadmap;
    const published = await env.DB.prepare(`
      SELECT passage_id FROM passages_runtime WHERE passage_id = ?
    `).bind(input.passage_id).first<{ passage_id: string }>();
    if (!published) return errorResponse(404, 'NOT_FOUND', 'Passage chưa được publish', origin);
    const ids = await roadmapPassageIds(env, roadmap.id);
    const position = input.position ?? ids.length;
    if (position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số bài học hiện có', origin);
    const id = generateUUIDv7();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE learner_roadmap_passages
        SET position = position + ${TEMPORARY_POSITION_OFFSET}
        WHERE learner_roadmap_id = ?
      `).bind(roadmap.id),
      env.DB.prepare(`
        INSERT INTO learner_roadmap_passages (id, learner_roadmap_id, passage_id, position)
        VALUES (?, ?, ?, ${TEMPORARY_POSITION_OFFSET - 1})
      `).bind(id, roadmap.id, input.passage_id),
      ...insertAt(ids, id, position).map((mappingId, finalPosition) => (
        env.DB.prepare('UPDATE learner_roadmap_passages SET position = ? WHERE id = ?').bind(finalPosition, mappingId)
      )),
      env.DB.prepare('UPDATE learner_roadmaps SET updated_at = unixepoch() WHERE id = ?').bind(roadmap.id),
    ]);
    return handleGetLearnerRoadmap(env, origin, userId, roadmap.id);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', 'Passage đã có trong roadmap linh hoạt', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteLearnerRoadmapPassage(
  env: Env,
  origin: string,
  userId: string,
  learnerRoadmapId: string,
  passageId: string,
): Promise<Response> {
  try {
    const roadmap = await requireFlexibleRoadmap(env, userId, origin, learnerRoadmapId);
    if (isResponse(roadmap)) return roadmap;
    const mapping = await env.DB.prepare(`
      SELECT id FROM learner_roadmap_passages
      WHERE learner_roadmap_id = ? AND passage_id = ?
    `).bind(roadmap.id, passageId).first<{ id: string }>();
    if (!mapping) return errorResponse(404, 'NOT_FOUND', 'Passage không có trong roadmap linh hoạt', origin);
    const ids = (await roadmapPassageIds(env, roadmap.id)).filter(id => id !== mapping.id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM learner_roadmap_passages WHERE id = ?').bind(mapping.id),
      ...reorderStatements(env, roadmap.id, ids),
      env.DB.prepare('UPDATE learner_roadmaps SET updated_at = unixepoch() WHERE id = ?').bind(roadmap.id),
    ]);
    return handleGetLearnerRoadmap(env, origin, userId, roadmap.id);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
