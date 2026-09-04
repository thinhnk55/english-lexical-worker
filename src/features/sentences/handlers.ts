import { successResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { generateUUIDv7 } from '../../utils/uuid';
import type { Sentence, SentenceLexical, SentenceLexicalRow, SentenceRow } from './types';
import { parseOptionalMediaUrl } from '../../utils/media';

interface SentenceInput {
  text: string;
  tokens: string[];
  translations: Record<string, string> | null;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
}

interface SentenceLexicalInput {
  lexical_id: string;
  position: number | null;
  token_indexes: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isTranslationMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === 'string');
}

function parseSentence(row: SentenceRow): Sentence {
  const tokens = parseJson<unknown>(row.tokens, []);
  const translations = parseJson<unknown>(row.translations, null);
  return {
    id: row.id,
    text: row.text,
    tokens: Array.isArray(tokens) && tokens.every(token => typeof token === 'string') ? tokens : [],
    translations: isTranslationMap(translations) ? translations : null,
    phonemes: row.phonemes,
    audio: row.audio,
    image: row.image,
  };
}

function parseSentenceLexical(row: SentenceLexicalRow): SentenceLexical {
  return {
    ...row,
  };
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isForeignKeyConstraint(error: unknown): boolean {
  return error instanceof Error && /foreign key/i.test(error.message);
}

async function readSentenceInput(request: Request, origin: string): Promise<SentenceInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu sentence không hợp lệ', origin);
  }
  const value = body as Record<string, unknown>;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const tokens = value.tokens;
  if (!text) return errorResponse(400, 'VALIDATION_ERROR', 'Trường text không được để trống', origin);
  if (!Array.isArray(tokens) || tokens.length === 0 || !tokens.every(token => typeof token === 'string' && token.length > 0)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'tokens phải là mảng chuỗi không rỗng', origin);
  }
  if (value.translations !== undefined && value.translations !== null && !isTranslationMap(value.translations)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'translations phải là object đa ngôn ngữ', origin);
  }
  if (value.phonemes !== undefined && value.phonemes !== null && typeof value.phonemes !== 'string') {
    return errorResponse(400, 'VALIDATION_ERROR', 'phonemes phải là chuỗi hoặc null', origin);
  }
  const audio = parseOptionalMediaUrl(value.audio, 'audio', origin);
  if (isResponse(audio)) return audio;
  const image = parseOptionalMediaUrl(value.image, 'image', origin);
  if (isResponse(image)) return image;
  return {
    text,
    tokens,
    translations: value.translations === null || value.translations === undefined ? null : value.translations as Record<string, string>,
    phonemes: typeof value.phonemes === 'string' ? value.phonemes.trim() || null : null,
    audio: audio ?? null,
    image: image ?? null,
  };
}

async function readSentenceLexicalInput(request: Request, origin: string): Promise<SentenceLexicalInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu mapping không hợp lệ', origin);
  }
  const value = body as Record<string, unknown>;
  const lexicalId = typeof value.lexical_id === 'string' ? value.lexical_id.trim() : '';
  const tokenIndexes = value.token_indexes === null || value.token_indexes === undefined
    ? null
    : typeof value.token_indexes === 'string' ? value.token_indexes : undefined;
  const position = value.position === null || value.position === undefined
    ? null
    : typeof value.position === 'number' && Number.isInteger(value.position) && value.position >= 0 ? value.position : -1;
  if (!lexicalId) return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu lexical_id', origin);
  if (tokenIndexes === undefined) return errorResponse(400, 'VALIDATION_ERROR', 'token_indexes phải là chuỗi hoặc null', origin);
  if (position === -1) return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm hoặc null', origin);
  return { lexical_id: lexicalId, position, token_indexes: tokenIndexes };
}

export async function handleListSentences(request: Request, env: Env, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { page, size, offset } = parsePagination(url);
    const text = url.searchParams.get('text')?.trim().toLowerCase();
    const where = text ? 'WHERE LOWER(text) LIKE ?' : '';
    const params = text ? [`%${text}%`] : [];
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM sentences ${where}`).bind(...params).first<{ total: number }>();
    const rows = await env.DB.prepare(`SELECT * FROM sentences ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...params, size, offset).all<SentenceRow>();
    return successResponse(200, 'SUCCESS', rows.results.map(parseSentence), origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetSentence(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const row = await env.DB.prepare('SELECT * FROM sentences WHERE id = ?').bind(id).first<SentenceRow>();
    if (!row) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', parseSentence(row), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateSentence(request: Request, env: Env, origin: string): Promise<Response> {
  const input = await readSentenceInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    await env.DB.prepare('INSERT INTO sentences (id, text, tokens, translations, phonemes, audio, image) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.text, JSON.stringify(input.tokens), input.translations ? JSON.stringify(input.translations) : null, input.phonemes, input.audio, input.image)
      .run();
    return successResponse(201, 'CREATED', { id, ...input }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateSentence(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readSentenceInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = await env.DB.prepare('UPDATE sentences SET text = ?, tokens = ?, translations = ?, phonemes = ?, audio = ?, image = ? WHERE id = ?')
      .bind(input.text, JSON.stringify(input.tokens), input.translations ? JSON.stringify(input.translations) : null, input.phonemes, input.audio, input.image, id)
      .run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'UPDATED', { id, ...input }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteSentence(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM sentences WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'Không thể xóa sentence đang được lexical hoặc paragraph sử dụng', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListSentenceLexicals(env: Env, origin: string, sentenceId: string): Promise<Response> {
  try {
    const rows = await env.DB.prepare('SELECT * FROM sentence_lexicals WHERE sentence_id = ? ORDER BY position ASC, id ASC').bind(sentenceId).all<SentenceLexicalRow>();
    return successResponse(200, 'SUCCESS', rows.results.map(parseSentenceLexical), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateSentenceLexical(request: Request, env: Env, origin: string, sentenceId: string): Promise<Response> {
  const input = await readSentenceLexicalInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    await env.DB.prepare('INSERT INTO sentence_lexicals (id, sentence_id, lexical_id, position, token_indexes) VALUES (?, ?, ?, ?, ?)')
      .bind(id, sentenceId, input.lexical_id, input.position, input.token_indexes)
      .run();
    return successResponse(201, 'CREATED', { id, sentence_id: sentenceId, ...input }, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'sentence_id hoặc lexical_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateSentenceLexical(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT sentence_id FROM sentence_lexicals WHERE id = ?').bind(id).first<{ sentence_id: string }>();
  if (!existing) return errorResponse(404, 'NOT_FOUND', undefined, origin);
  const input = await readSentenceLexicalInput(request, origin);
  if (isResponse(input)) return input;
  try {
    await env.DB.prepare('UPDATE sentence_lexicals SET lexical_id = ?, position = ?, token_indexes = ? WHERE id = ?')
      .bind(input.lexical_id, input.position, input.token_indexes, id)
      .run();
    return successResponse(200, 'UPDATED', { id, sentence_id: existing.sentence_id, ...input }, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'sentence_id hoặc lexical_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteSentenceLexical(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM sentence_lexicals WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
