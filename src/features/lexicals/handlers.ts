import { successResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { generateUUIDv7 } from '../../utils/uuid';

interface LexicalRow {
  id: string;
  text: string;
  type: string;
  translations: string;
  phonemes: string | null;
  created_at: string;
  updated_at: string;
}

interface Lexical {
  id: string;
  text: string;
  type: string;
  translations: Record<string, string>;
  phonemes: string | null;
  created_at: string;
  updated_at: string;
}

interface LexicalInput {
  text: string;
  type: string;
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
  if (!isTranslationMap(value.translations)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'translations phải là object gồm các cặp ngôn ngữ và bản dịch', origin);
  }
  if (!isPhonemes(value.phonemes)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'phonemes phải là chuỗi hoặc null', origin);
  }
  return { text, type, translations: value.translations, phonemes: value.phonemes?.trim() || null };
}

function isResponse(value: LexicalInput | Response): value is Response {
  return value instanceof Response;
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
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
    const result = await env.DB.prepare('UPDATE lexicals SET text = ?, type = ?, translations = ?, phonemes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
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
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
