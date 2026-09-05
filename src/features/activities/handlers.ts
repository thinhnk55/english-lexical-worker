import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';

const TEMPORARY_POSITION_OFFSET = 1_000_000;

interface ActivityRow {
  id: string;
  passage_id: string;
  code: string;
  name: string;
  position: number;
  config: string;
  is_enabled: number;
}

interface ActivityInput {
  code: string;
  name: string;
  position?: number;
  config: unknown;
  is_enabled: boolean;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function parseConfig(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseActivity(row: ActivityRow) {
  return {
    id: row.id,
    passage_id: row.passage_id,
    code: row.code,
    name: row.name,
    position: row.position,
    config: parseConfig(row.config),
    is_enabled: row.is_enabled === 1,
  };
}

async function readInput(request: Request, origin: string, requirePosition: boolean): Promise<ActivityInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu activity không hợp lệ', origin);
  }
  const value = body as Record<string, unknown>;
  const code = typeof value.code === 'string' ? value.code.trim() : '';
  if (!code || !/^[a-z0-9][a-z0-9_-]*$/.test(code)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'code chỉ gồm chữ thường, số, dấu _ hoặc -', origin);
  }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return errorResponse(400, 'VALIDATION_ERROR', 'name không được để trống', origin);
  const position = value.position;
  if ((requirePosition || position !== undefined) && (!Number.isSafeInteger(position) || (position as number) < 0)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
  }
  const isEnabled = value.is_enabled === undefined ? true : value.is_enabled;
  if (typeof isEnabled !== 'boolean') {
    return errorResponse(400, 'VALIDATION_ERROR', 'is_enabled phải là boolean', origin);
  }
  const config = value.config === undefined ? {} : value.config;
  try {
    JSON.stringify(config);
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'config không thể chuyển thành JSON', origin);
  }
  return {
    code,
    name,
    ...(position === undefined ? {} : { position: position as number }),
    config,
    is_enabled: isEnabled,
  };
}

async function getActivity(env: Env, id: string): Promise<ActivityRow | null> {
  return env.DB.prepare(`
    SELECT id, passage_id, code, name, position, config, is_enabled
    FROM passage_activities
    WHERE id = ?
  `).bind(id).first<ActivityRow>();
}

async function activityIds(env: Env, passageId: string): Promise<string[]> {
  const rows = await env.DB.prepare(`
    SELECT id FROM passage_activities WHERE passage_id = ? ORDER BY position ASC
  `).bind(passageId).all<{ id: string }>();
  return rows.results.map(row => row.id);
}

function insertAt(ids: string[], id: string, position: number): string[] {
  return [...ids.slice(0, position), id, ...ids.slice(position)];
}

function orderStatements(env: Env, passageId: string, ids: string[]): D1PreparedStatement[] {
  if (ids.length === 0) return [];
  return [
    env.DB.prepare(`
      UPDATE passage_activities
      SET position = position + ${TEMPORARY_POSITION_OFFSET}
      WHERE passage_id = ?
    `).bind(passageId),
    ...ids.map((id, position) => env.DB.prepare('UPDATE passage_activities SET position = ? WHERE id = ?').bind(position, id)),
  ];
}

export async function handleListPassageActivities(env: Env, origin: string, passageId: string): Promise<Response> {
  try {
    const passage = await env.DB.prepare('SELECT id FROM passages WHERE id = ?').bind(passageId).first<{ id: string }>();
    if (!passage) return errorResponse(404, 'NOT_FOUND', 'Passage không tồn tại', origin);
    const rows = await env.DB.prepare(`
      SELECT id, passage_id, code, name, position, config, is_enabled
      FROM passage_activities
      WHERE passage_id = ?
      ORDER BY position ASC, id ASC
    `).bind(passageId).all<ActivityRow>();
    return successResponse(200, 'SUCCESS', rows.results.map(parseActivity), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreatePassageActivity(request: Request, env: Env, origin: string, passageId: string): Promise<Response> {
  const input = await readInput(request, origin, false);
  if (isResponse(input)) return input;
  try {
    const passage = await env.DB.prepare('SELECT id FROM passages WHERE id = ?').bind(passageId).first<{ id: string }>();
    if (!passage) return errorResponse(404, 'NOT_FOUND', 'Passage không tồn tại', origin);
    const ids = await activityIds(env, passageId);
    const position = input.position ?? ids.length;
    if (position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số activity hiện có', origin);
    const id = generateUUIDv7();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE passage_activities
        SET position = position + ${TEMPORARY_POSITION_OFFSET}
        WHERE passage_id = ?
      `).bind(passageId),
      env.DB.prepare(`
        INSERT INTO passage_activities (id, passage_id, code, name, position, config, is_enabled)
        VALUES (?, ?, ?, ?, ${TEMPORARY_POSITION_OFFSET - 1}, ?, ?)
      `).bind(id, passageId, input.code, input.name, JSON.stringify(input.config), input.is_enabled ? 1 : 0),
      ...insertAt(ids, id, position).map((activityId, finalPosition) => (
        env.DB.prepare('UPDATE passage_activities SET position = ? WHERE id = ?').bind(finalPosition, activityId)
      )),
    ]);
    const activity = await getActivity(env, id);
    return successResponse(201, 'CREATED', activity ? parseActivity(activity) : undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetPassageActivity(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const activity = await getActivity(env, id);
    if (!activity) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', parseActivity(activity), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdatePassageActivity(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readInput(request, origin, true);
  if (isResponse(input) || input.position === undefined) {
    return isResponse(input) ? input : errorResponse(400, 'VALIDATION_ERROR', 'Thiếu position', origin);
  }
  try {
    const activity = await getActivity(env, id);
    if (!activity) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await activityIds(env, activity.passage_id)).filter(activityId => activityId !== id);
    if (input.position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số activity hiện có', origin);
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE passage_activities
        SET position = position + ${TEMPORARY_POSITION_OFFSET}
        WHERE passage_id = ?
      `).bind(activity.passage_id),
      env.DB.prepare(`
        UPDATE passage_activities
        SET code = ?, name = ?, position = ${TEMPORARY_POSITION_OFFSET - 1}, config = ?, is_enabled = ?
        WHERE id = ?
      `).bind(input.code, input.name, JSON.stringify(input.config), input.is_enabled ? 1 : 0, id),
      ...insertAt(ids, id, input.position).map((activityId, finalPosition) => (
        env.DB.prepare('UPDATE passage_activities SET position = ? WHERE id = ?').bind(finalPosition, activityId)
      )),
    ]);
    const updated = await getActivity(env, id);
    return successResponse(200, 'UPDATED', updated ? parseActivity(updated) : undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeletePassageActivity(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const activity = await getActivity(env, id);
    if (!activity) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await activityIds(env, activity.passage_id)).filter(activityId => activityId !== id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM passage_activities WHERE id = ?').bind(id),
      ...orderStatements(env, activity.passage_id, ids),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    if (error instanceof Error && /foreign key/i.test(error.message)) {
      return errorResponse(409, 'CONFLICT', 'Activity đã có kết quả học tập nên không thể xóa', origin);
    }
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
