import { parseOptionalMediaUrl } from '../../utils/media';
import { parsePagination } from '../../utils/pagination';
import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';

const TEMPORARY_POSITION_OFFSET = 1_000_000;

interface RoadmapRow {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  published_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RoadmapPassageRow {
  id: string;
  roadmap_id: string;
  passage_id: string;
  position: number;
  title: string;
  image: string | null;
  summary: string | null;
  difficulty: number | null;
  reward_points: number;
  is_published: number;
}

interface RoadmapInput {
  name: string;
  description: string | null;
  image: string | null;
}

interface RoadmapPassageInput {
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

async function readRoadmapInput(request: Request, origin: string): Promise<RoadmapInput | Response> {
  const body = await readObject(request, origin);
  if (isResponse(body)) return body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return errorResponse(400, 'VALIDATION_ERROR', 'name không được để trống', origin);
  const description = body.description === undefined || body.description === null
    ? null
    : typeof body.description === 'string' ? body.description.trim() || null : undefined;
  if (description === undefined) return errorResponse(400, 'VALIDATION_ERROR', 'description phải là chuỗi hoặc null', origin);
  const image = parseOptionalMediaUrl(body.image, 'image', origin);
  if (isResponse(image)) return image;
  return { name, description, image: image ?? null };
}

async function readRoadmapPassageInput(request: Request, origin: string, requirePosition: boolean): Promise<RoadmapPassageInput | Response> {
  const body = await readObject(request, origin);
  if (isResponse(body)) return body;
  const passageId = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
  if (!passageId) return errorResponse(400, 'VALIDATION_ERROR', 'passage_id không được để trống', origin);
  const position = body.position;
  if ((requirePosition || position !== undefined) && (!Number.isSafeInteger(position) || (position as number) < 0)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
  }
  return { passage_id: passageId, ...(position === undefined ? {} : { position: position as number }) };
}

async function getRoadmap(env: Env, id: string): Promise<RoadmapRow | null> {
  return env.DB.prepare(`
    SELECT id, name, description, image, published_at, archived_at, created_at, updated_at
    FROM roadmaps
    WHERE id = ?
  `).bind(id).first<RoadmapRow>();
}

async function getRoadmapPassage(env: Env, id: string): Promise<RoadmapPassageRow | null> {
  return env.DB.prepare(`
    SELECT
      mapping.id,
      mapping.roadmap_id,
      mapping.passage_id,
      mapping.position,
      title.text AS title,
      passage.image,
      passage.summary,
      passage.difficulty,
      passage.reward_points,
      CASE WHEN runtime.passage_id IS NULL THEN 0 ELSE 1 END AS is_published
    FROM roadmap_passages mapping
    JOIN passages passage ON passage.id = mapping.passage_id
    JOIN sentences title ON title.id = passage.title_sentence_id
    LEFT JOIN passages_runtime runtime ON runtime.passage_id = passage.id
    WHERE mapping.id = ?
  `).bind(id).first<RoadmapPassageRow>();
}

async function listRoadmapPassages(env: Env, roadmapId: string): Promise<RoadmapPassageRow[]> {
  const rows = await env.DB.prepare(`
    SELECT
      mapping.id,
      mapping.roadmap_id,
      mapping.passage_id,
      mapping.position,
      title.text AS title,
      passage.image,
      passage.summary,
      passage.difficulty,
      passage.reward_points,
      CASE WHEN runtime.passage_id IS NULL THEN 0 ELSE 1 END AS is_published
    FROM roadmap_passages mapping
    JOIN passages passage ON passage.id = mapping.passage_id
    JOIN sentences title ON title.id = passage.title_sentence_id
    LEFT JOIN passages_runtime runtime ON runtime.passage_id = passage.id
    WHERE mapping.roadmap_id = ?
    ORDER BY mapping.position ASC, mapping.id ASC
  `).bind(roadmapId).all<RoadmapPassageRow>();
  return rows.results;
}

function parseRoadmapPassage(row: RoadmapPassageRow) {
  return { ...row, is_published: row.is_published === 1 };
}

async function roadmapPassageIds(env: Env, roadmapId: string): Promise<string[]> {
  const rows = await env.DB.prepare(`
    SELECT id FROM roadmap_passages WHERE roadmap_id = ? ORDER BY position ASC
  `).bind(roadmapId).all<{ id: string }>();
  return rows.results.map(row => row.id);
}

function insertAt(ids: string[], id: string, position: number): string[] {
  return [...ids.slice(0, position), id, ...ids.slice(position)];
}

function orderStatements(env: Env, roadmapId: string, ids: string[]): D1PreparedStatement[] {
  if (ids.length === 0) return [];
  return [
    env.DB.prepare(`
      UPDATE roadmap_passages
      SET position = position + ${TEMPORARY_POSITION_OFFSET}
      WHERE roadmap_id = ?
    `).bind(roadmapId),
    ...ids.map((id, position) => env.DB.prepare('UPDATE roadmap_passages SET position = ? WHERE id = ?').bind(position, id)),
  ];
}

export async function handleListAdminRoadmaps(request: Request, env: Env, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { page, size, offset } = parsePagination(url);
    const status = url.searchParams.get('status');
    const where = status === 'draft'
      ? 'WHERE published_at IS NULL'
      : status === 'published'
        ? 'WHERE published_at IS NOT NULL AND archived_at IS NULL'
        : status === 'archived'
          ? 'WHERE archived_at IS NOT NULL'
          : '';
    const [count, rows] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS total FROM roadmaps ${where}`).first<{ total: number }>(),
      env.DB.prepare(`
        SELECT id, name, description, image, published_at, archived_at, created_at, updated_at
        FROM roadmaps
        ${where}
        ORDER BY updated_at DESC, id ASC
        LIMIT ? OFFSET ?
      `).bind(size, offset).all<RoadmapRow>(),
    ]);
    return successResponse(200, 'SUCCESS', rows.results, origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetAdminRoadmap(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const roadmap = await getRoadmap(env, id);
    if (!roadmap) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const passages = await listRoadmapPassages(env, id);
    return successResponse(200, 'SUCCESS', { ...roadmap, passages: passages.map(parseRoadmapPassage) }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateRoadmap(request: Request, env: Env, origin: string): Promise<Response> {
  const input = await readRoadmapInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    await env.DB.prepare(`
      INSERT INTO roadmaps (id, name, description, image)
      VALUES (?, ?, ?, ?)
    `).bind(id, input.name, input.description, input.image).run();
    return successResponse(201, 'CREATED', await getRoadmap(env, id) ?? undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateRoadmap(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readRoadmapInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = await env.DB.prepare(`
      UPDATE roadmaps
      SET name = ?, description = ?, image = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(input.name, input.description, input.image, id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'UPDATED', await getRoadmap(env, id) ?? undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteRoadmap(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM roadmaps WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', 'Roadmap đã được học viên sử dụng nên không thể xóa', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleSetRoadmapLifecycle(env: Env, origin: string, id: string, action: 'publish' | 'unpublish' | 'archive' | 'unarchive'): Promise<Response> {
  try {
    const roadmap = await getRoadmap(env, id);
    if (!roadmap) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    if (action === 'archive' && roadmap.published_at === null) {
      return errorResponse(409, 'CONFLICT', 'Chỉ roadmap đã publish mới có thể archive', origin);
    }
    const sql = action === 'publish'
      ? 'UPDATE roadmaps SET published_at = COALESCE(published_at, unixepoch()), archived_at = NULL, updated_at = unixepoch() WHERE id = ?'
      : action === 'unpublish'
        ? 'UPDATE roadmaps SET published_at = NULL, archived_at = NULL, updated_at = unixepoch() WHERE id = ?'
        : action === 'archive'
          ? 'UPDATE roadmaps SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ?'
          : 'UPDATE roadmaps SET archived_at = NULL, updated_at = unixepoch() WHERE id = ?';
    await env.DB.prepare(sql).bind(id).run();
    return successResponse(200, 'UPDATED', await getRoadmap(env, id) ?? undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListRoadmapPassages(env: Env, origin: string, roadmapId: string): Promise<Response> {
  try {
    if (!await getRoadmap(env, roadmapId)) return errorResponse(404, 'NOT_FOUND', 'Roadmap không tồn tại', origin);
    const passages = await listRoadmapPassages(env, roadmapId);
    return successResponse(200, 'SUCCESS', passages.map(parseRoadmapPassage), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateRoadmapPassage(request: Request, env: Env, origin: string, roadmapId: string): Promise<Response> {
  const input = await readRoadmapPassageInput(request, origin, false);
  if (isResponse(input)) return input;
  try {
    if (!await getRoadmap(env, roadmapId)) return errorResponse(404, 'NOT_FOUND', 'Roadmap không tồn tại', origin);
    const ids = await roadmapPassageIds(env, roadmapId);
    const position = input.position ?? ids.length;
    if (position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số passage hiện có', origin);
    const id = generateUUIDv7();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE roadmap_passages
        SET position = position + ${TEMPORARY_POSITION_OFFSET}
        WHERE roadmap_id = ?
      `).bind(roadmapId),
      env.DB.prepare(`
        INSERT INTO roadmap_passages (id, roadmap_id, passage_id, position)
        VALUES (?, ?, ?, ${TEMPORARY_POSITION_OFFSET - 1})
      `).bind(id, roadmapId, input.passage_id),
      ...insertAt(ids, id, position).map((mappingId, finalPosition) => (
        env.DB.prepare('UPDATE roadmap_passages SET position = ? WHERE id = ?').bind(finalPosition, mappingId)
      )),
      env.DB.prepare('UPDATE roadmaps SET updated_at = unixepoch() WHERE id = ?').bind(roadmapId),
    ]);
    const mapping = await getRoadmapPassage(env, id);
    return successResponse(201, 'CREATED', mapping ? parseRoadmapPassage(mapping) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', 'Passage không tồn tại hoặc đã có trong roadmap', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetRoadmapPassage(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const mapping = await getRoadmapPassage(env, id);
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', parseRoadmapPassage(mapping), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateRoadmapPassage(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readRoadmapPassageInput(request, origin, true);
  if (isResponse(input) || input.position === undefined) {
    return isResponse(input) ? input : errorResponse(400, 'VALIDATION_ERROR', 'Thiếu position', origin);
  }
  try {
    const mapping = await getRoadmapPassage(env, id);
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await roadmapPassageIds(env, mapping.roadmap_id)).filter(mappingId => mappingId !== id);
    if (input.position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số passage hiện có', origin);
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE roadmap_passages
        SET position = position + ${TEMPORARY_POSITION_OFFSET}
        WHERE roadmap_id = ?
      `).bind(mapping.roadmap_id),
      env.DB.prepare(`
        UPDATE roadmap_passages
        SET passage_id = ?, position = ${TEMPORARY_POSITION_OFFSET - 1}
        WHERE id = ?
      `).bind(input.passage_id, id),
      ...insertAt(ids, id, input.position).map((mappingId, finalPosition) => (
        env.DB.prepare('UPDATE roadmap_passages SET position = ? WHERE id = ?').bind(finalPosition, mappingId)
      )),
      env.DB.prepare('UPDATE roadmaps SET updated_at = unixepoch() WHERE id = ?').bind(mapping.roadmap_id),
    ]);
    const updated = await getRoadmapPassage(env, id);
    return successResponse(200, 'UPDATED', updated ? parseRoadmapPassage(updated) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', 'Passage không tồn tại, đã có trong roadmap hoặc mapping đã được học viên sử dụng', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteRoadmapPassage(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const mapping = await getRoadmapPassage(env, id);
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await roadmapPassageIds(env, mapping.roadmap_id)).filter(mappingId => mappingId !== id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM roadmap_passages WHERE id = ?').bind(id),
      ...orderStatements(env, mapping.roadmap_id, ids),
      env.DB.prepare('UPDATE roadmaps SET updated_at = unixepoch() WHERE id = ?').bind(mapping.roadmap_id),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', 'Passage trong roadmap đã được học viên sử dụng nên không thể xóa', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
