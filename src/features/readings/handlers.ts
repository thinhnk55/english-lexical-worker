import { successResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { generateUUIDv7 } from '../../utils/uuid';
import type { ReadingRow, ReadingSentenceRow } from './types';

interface ReadingInput {
  title_sentence_id: string;
}

interface ReadingSentenceInput {
  sentence_id: string;
  position: number;
}

function isResponse(value: ReadingInput | ReadingSentenceInput | Response): value is Response {
  return value instanceof Response;
}

function isForeignKeyConstraint(error: unknown): boolean {
  return error instanceof Error && /foreign key/i.test(error.message);
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

async function readReadingInput(request: Request, origin: string): Promise<ReadingInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu reading không hợp lệ', origin);
  }
  const value = body as Record<string, unknown>;
  const titleSentenceId = typeof value.title_sentence_id === 'string' ? value.title_sentence_id.trim() : '';
  if (!titleSentenceId) return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu title_sentence_id', origin);
  return { title_sentence_id: titleSentenceId };
}

async function readReadingSentenceInput(request: Request, origin: string): Promise<ReadingSentenceInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu reading sentence không hợp lệ', origin);
  }
  const value = body as Record<string, unknown>;
  const sentenceId = typeof value.sentence_id === 'string' ? value.sentence_id.trim() : '';
  const position = value.position;
  if (!sentenceId) return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu sentence_id', origin);
  if (typeof position !== 'number' || !Number.isInteger(position)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên', origin);
  }
  return { sentence_id: sentenceId, position };
}

export async function handleListReadings(request: Request, env: Env, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { page, size, offset } = parsePagination(url);
    const rows = await env.DB.prepare('SELECT * FROM readings ORDER BY id DESC LIMIT ? OFFSET ?').bind(size, offset).all<ReadingRow>();
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM readings').first<{ total: number }>();
    return successResponse(200, 'SUCCESS', rows.results, origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetReading(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const row = await env.DB.prepare('SELECT * FROM readings WHERE id = ?').bind(id).first<ReadingRow>();
    if (!row) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', row, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateReading(request: Request, env: Env, origin: string): Promise<Response> {
  const input = await readReadingInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    await env.DB.prepare('INSERT INTO readings (id, title_sentence_id) VALUES (?, ?)').bind(id, input.title_sentence_id).run();
    return successResponse(201, 'CREATED', { id, ...input }, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'title_sentence_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateReading(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readReadingInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = await env.DB.prepare('UPDATE readings SET title_sentence_id = ? WHERE id = ?').bind(input.title_sentence_id, id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'UPDATED', { id, ...input }, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'title_sentence_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteReading(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM readings WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListReadingSentences(env: Env, origin: string, readingId: string): Promise<Response> {
  try {
    const rows = await env.DB.prepare('SELECT * FROM reading_sentences WHERE reading_id = ? ORDER BY position ASC').bind(readingId).all<ReadingSentenceRow>();
    return successResponse(200, 'SUCCESS', rows.results, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleAddReadingSentence(request: Request, env: Env, origin: string, readingId: string): Promise<Response> {
  const input = await readReadingSentenceInput(request, origin);
  if (isResponse(input)) return input;
  try {
    await env.DB.prepare('INSERT INTO reading_sentences (reading_id, sentence_id, position) VALUES (?, ?, ?)')
      .bind(readingId, input.sentence_id, input.position)
      .run();
    return successResponse(201, 'CREATED', { reading_id: readingId, ...input }, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'reading_id hoặc sentence_id không tồn tại', origin);
    if (isUniqueConstraint(error)) return errorResponse(409, 'CONFLICT', 'position đã tồn tại trong reading', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateReadingSentence(request: Request, env: Env, origin: string, readingId: string, position: string): Promise<Response> {
  const oldPosition = Number.parseInt(position, 10);
  if (!Number.isInteger(oldPosition)) return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên', origin);
  const input = await readReadingSentenceInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = await env.DB.prepare('UPDATE reading_sentences SET sentence_id = ? WHERE reading_id = ? AND position = ?')
      .bind(input.sentence_id, readingId, oldPosition)
      .run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'UPDATED', { reading_id: readingId, position: oldPosition, sentence_id: input.sentence_id }, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'sentence_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteReadingSentence(env: Env, origin: string, readingId: string, position: string): Promise<Response> {
  const parsedPosition = Number.parseInt(position, 10);
  if (!Number.isInteger(parsedPosition)) return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên', origin);
  try {
    const result = await env.DB.prepare('DELETE FROM reading_sentences WHERE reading_id = ? AND position = ?').bind(readingId, parsedPosition).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
