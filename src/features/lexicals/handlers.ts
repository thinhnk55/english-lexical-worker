import { successResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { generateUUIDv7 } from '../../utils/uuid';
import { isLexicalType, normalizeLexicalText, type LexicalType } from './constants';

interface LexicalRow {
  id: string;
  text: string;
  type: string;
  translations: string;
  phonemes: string | null;
}

interface Lexical {
  id: string;
  text: string;
  type: string;
  translations: Record<string, string>;
  phonemes: string | null;
}

interface LexicalInput {
  text: string;
  type: LexicalType;
  translations: Record<string, string>;
  phonemes: string | null;
}

function parseRow(row: LexicalRow): Lexical {
  let translations: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.translations || '{}');
    if (isTranslationMap(parsed)) translations = parsed;
  } catch {
    // Keep the API shape stable even if a manually edited row is malformed.
  }
  return { ...row, translations };
}

function isTranslationMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === 'string');
}

function isPhonemes(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

async function readInput(request: Request, origin: string): Promise<LexicalInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu lexical không hợp lệ', origin);
  }
  const value = body as Record<string, unknown>;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const type = typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
  if (!text) return errorResponse(400, 'VALIDATION_ERROR', 'Trường text không được để trống', origin);
  if (!type) return errorResponse(400, 'VALIDATION_ERROR', 'Trường type không được để trống', origin);
  if (!isLexicalType(type)) {
    return errorResponse(400, 'VALIDATION_ERROR', `type phải là một trong: vocabulary, phrase, collocation, phrasal_verb, idiom, pattern`, origin);
  }
  if (!isTranslationMap(value.translations)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'translations phải là object gồm các cặp ngôn ngữ và bản dịch', origin);
  }
  if (!isPhonemes(value.phonemes)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'phonemes phải là chuỗi hoặc null', origin);
  }
  return { text, type, translations: value.translations, phonemes: value.phonemes?.trim() || null };
}

interface LexicalBatchItem extends LexicalInput {
  client_key?: string;
}

interface LexicalBatchDecision extends LexicalBatchItem {
  client_key: string;
  action: 'create' | 'update' | 'skip';
  existing_id?: string;
}

async function readBatchItems(request: Request, origin: string): Promise<LexicalBatchItem[] | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'items phải là một mảng lexical', origin);
  }
  const items = (body as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    return errorResponse(400, 'VALIDATION_ERROR', 'items phải có từ 1 đến 100 phần tử', origin);
  }

  const parsed: LexicalBatchItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return errorResponse(400, 'VALIDATION_ERROR', `Phần tử thứ ${index + 1} không hợp lệ`, origin);
    }
    const input = await readInput(new Request('https://internal', {
      method: 'POST',
      body: JSON.stringify(item),
      headers: { 'content-type': 'application/json' },
    }), origin);
    if (isResponse(input)) return errorResponse(400, 'VALIDATION_ERROR', { index, error: await input.json() }, origin);
    const clientKey = typeof (item as Record<string, unknown>).client_key === 'string'
      ? (item as Record<string, unknown>).client_key as string
      : String(index);
    parsed.push({ ...input, client_key: clientKey });
  }
  return parsed;
}

async function findLexicalsByText(env: Env, text: string): Promise<Lexical[]> {
  const normalized = normalizeLexicalText(text);
  const rows = await env.DB.prepare('SELECT * FROM lexicals WHERE LOWER(TRIM(text)) = ? ORDER BY type ASC')
    .bind(normalized).all<LexicalRow>();
  return rows.results.map(parseRow);
}

function isResponse(value: LexicalInput | Response): value is Response {
  return value instanceof Response;
}

function isErrorResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

function isForeignKeyConstraint(error: unknown): boolean {
  return error instanceof Error && /foreign key/i.test(error.message);
}

export async function handleListLexicals(request: Request, env: Env, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { page, size, offset } = parsePagination(url);
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    const text = url.searchParams.get('text')?.trim().toLowerCase();
    const type = url.searchParams.get('type')?.trim().toLowerCase();
    if (text) {
      clauses.push('LOWER(text) LIKE ?');
      params.push(`%${text}%`);
    }
    if (type) {
      clauses.push('type = ?');
      params.push(type);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM lexicals ${where}`).bind(...params).first<{ total: number }>();
    const rows = await env.DB.prepare(`SELECT * FROM lexicals ${where} ORDER BY text ASC, type ASC LIMIT ? OFFSET ?`).bind(...params, size, offset).all<LexicalRow>();
    return successResponse(200, 'SUCCESS', rows.results.map(parseRow), origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetLexical(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const row = await env.DB.prepare('SELECT * FROM lexicals WHERE id = ?').bind(id).first<LexicalRow>();
    if (!row) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', parseRow(row), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateLexical(request: Request, env: Env, origin: string): Promise<Response> {
  const input = await readInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    await env.DB.prepare('INSERT INTO lexicals (id, text, type, translations, phonemes) VALUES (?, ?, ?, ?, ?)')
      .bind(id, input.text, input.type, JSON.stringify(input.translations), input.phonemes)
      .run();
    const row = await env.DB.prepare('SELECT * FROM lexicals WHERE id = ?').bind(id).first<LexicalRow>();
    return successResponse(201, 'CREATED', row ? parseRow(row) : undefined, origin);
  } catch (error) {
    if (isUniqueConstraint(error)) return errorResponse(409, 'CONFLICT', 'Lexical với text và type này đã tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateLexical(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = await env.DB.prepare('UPDATE lexicals SET text = ?, type = ?, translations = ?, phonemes = ? WHERE id = ?')
      .bind(input.text, input.type, JSON.stringify(input.translations), input.phonemes, id)
      .run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const row = await env.DB.prepare('SELECT * FROM lexicals WHERE id = ?').bind(id).first<LexicalRow>();
    return successResponse(200, 'UPDATED', row ? parseRow(row) : undefined, origin);
  } catch (error) {
    if (isUniqueConstraint(error)) return errorResponse(409, 'CONFLICT', 'Lexical với text và type này đã tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteLexical(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM lexicals WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'Không thể xóa lexical đang được sentence sử dụng', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCheckLexicalDuplicates(request: Request, env: Env, origin: string): Promise<Response> {
  const items = await readBatchItems(request, origin);
  if (isErrorResponse(items)) return items;
  try {
    const result = [];
    const seen = new Map<string, number>();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const normalizedText = normalizeLexicalText(item.text);
      const key = `${normalizedText}::${item.type}`;
      const existing = await findLexicalsByText(env, item.text);
      const duplicateInBatch = seen.get(key);
      seen.set(key, index);
      result.push({
        index,
        client_key: item.client_key ?? String(index),
        input: item,
        normalized_text: normalizedText,
        status: existing.length === 0 && duplicateInBatch === undefined
          ? 'new'
          : duplicateInBatch !== undefined
            ? 'duplicate_in_batch'
            : 'duplicate',
        existing,
        duplicate_index: duplicateInBatch,
      });
    }
    return successResponse(200, 'SUCCESS', result, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleBulkLexicals(request: Request, env: Env, origin: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'items phải là một mảng lexical', origin);
  }
  const rawItems = (body as Record<string, unknown>).items;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 100) {
    return errorResponse(400, 'VALIDATION_ERROR', 'items phải có từ 1 đến 100 phần tử', origin);
  }
  const decisions: LexicalBatchDecision[] = [];
  for (const rawItem of rawItems) {
    if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Một phần tử trong items không hợp lệ', origin);
    }
    const item = rawItem as Record<string, unknown>;
    const action = item.action;
    if (action !== 'create' && action !== 'update' && action !== 'skip') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Mỗi item phải có action create, update hoặc skip', origin);
    }
    const input = await readInput(new Request('https://internal', {
      method: 'POST', body: JSON.stringify(item), headers: { 'content-type': 'application/json' },
    }), origin);
    if (isResponse(input)) return errorResponse(400, 'VALIDATION_ERROR', await input.json(), origin);
    const clientKey = typeof item.client_key === 'string' ? item.client_key : '';
    if (!clientKey) return errorResponse(400, 'VALIDATION_ERROR', 'client_key không được để trống', origin);
    decisions.push({ ...input, client_key: clientKey, action, existing_id: typeof item.existing_id === 'string' ? item.existing_id : undefined });
  }

  const statements: D1PreparedStatement[] = [];
  const createdKeys: string[] = [];
  const updatedKeys: string[] = [];
  for (const item of decisions) {
    if (item.action === 'skip') continue;
    if (item.action === 'update') {
      if (!item.existing_id) return errorResponse(400, 'VALIDATION_ERROR', `Thiếu existing_id cho ${item.client_key}`, origin);
      statements.push(env.DB.prepare('UPDATE lexicals SET text = ?, type = ?, translations = ?, phonemes = ? WHERE id = ?')
        .bind(item.text, item.type, JSON.stringify(item.translations), item.phonemes, item.existing_id));
      updatedKeys.push(item.client_key);
      continue;
    }
    statements.push(env.DB.prepare('INSERT INTO lexicals (id, text, type, translations, phonemes) VALUES (?, ?, ?, ?, ?)')
      .bind(generateUUIDv7(), item.text, item.type, JSON.stringify(item.translations), item.phonemes));
    createdKeys.push(item.client_key);
  }
  try {
    if (statements.length > 0) await env.DB.batch(statements);
    return successResponse(200, 'SUCCESS', {
      created: createdKeys,
      updated: updatedKeys,
      skipped: decisions.filter(item => item.action === 'skip').map(item => item.client_key),
    }, origin);
  } catch (error) {
    if (isUniqueConstraint(error)) return errorResponse(409, 'CONFLICT', 'Một lexical trong lô đã tồn tại. Hãy kiểm tra trùng lại trước khi ghi.', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
