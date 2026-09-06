import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';
import { readLexicalInput } from '../lexicals/handlers';
import {
  getSentenceAuthoringContext,
  invalidateRuntimeStatements,
  parseStoredTokenIndexes,
  validateTokenIndexes,
} from './context';

type JsonObject = Record<string, unknown>;

interface CandidateRow {
  id: string;
  text: string;
  type: string;
  translations: string;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
  mapping_id: string;
  sentence_id: string;
  sentence_text: string;
  position: number;
  token_indexes: string;
}

interface LexicalCandidate {
  id: string;
  text: string;
  type: string;
  translations: Record<string, string>;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
  contexts: Array<{
    mapping_id: string;
    sentence_id: string;
    sentence_text: string;
    position: number;
    token_indexes: number[];
  }>;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function parseTranslations(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

async function readBody(request: Request, origin: string): Promise<JsonObject | Response> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as JsonObject
      : errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu phải là JSON object', origin);
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
}

async function listCandidates(
  env: Env,
  passageId: string,
  text?: string,
  type?: string,
): Promise<LexicalCandidate[]> {
  const clauses = ['owner.passage_id = ?'];
  const params: string[] = [passageId];
  if (text) {
    clauses.push('LOWER(TRIM(lexical.text)) = LOWER(TRIM(?))');
    params.push(text);
  }
  if (type) {
    clauses.push('lexical.type = ?');
    params.push(type);
  }
  const rows = await env.DB.prepare(`
    SELECT
      lexical.id,
      lexical.text,
      lexical.type,
      lexical.translations,
      lexical.phonemes,
      lexical.audio,
      lexical.image,
      mapping.id AS mapping_id,
      mapping.sentence_id,
      sentence.text AS sentence_text,
      mapping.position,
      mapping.token_indexes
    FROM sentence_lexicals mapping
    JOIN sentence_passages owner ON owner.sentence_id = mapping.sentence_id
    JOIN sentences sentence ON sentence.id = mapping.sentence_id
    JOIN lexicals lexical ON lexical.id = mapping.lexical_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY lexical.text, lexical.type, lexical.id, mapping.position, mapping.id
  `).bind(...params).all<CandidateRow>();

  const byId = new Map<string, LexicalCandidate>();
  for (const row of rows.results) {
    let candidate = byId.get(row.id);
    if (!candidate) {
      candidate = {
        id: row.id,
        text: row.text,
        type: row.type,
        translations: parseTranslations(row.translations),
        phonemes: row.phonemes,
        audio: row.audio,
        image: row.image,
        contexts: [],
      };
      byId.set(row.id, candidate);
    }
    candidate.contexts.push({
      mapping_id: row.mapping_id,
      sentence_id: row.sentence_id,
      sentence_text: row.sentence_text,
      position: row.position,
      token_indexes: parseStoredTokenIndexes(row.token_indexes),
    });
  }
  return [...byId.values()];
}

export async function handleListPassageLexicalCandidates(
  request: Request,
  env: Env,
  origin: string,
  passageId: string,
): Promise<Response> {
  try {
    const passage = await env.DB.prepare('SELECT id FROM passages WHERE id = ?').bind(passageId).first<{ id: string }>();
    if (!passage) return errorResponse(404, 'NOT_FOUND', 'Passage không tồn tại', origin);
    const url = new URL(request.url);
    const text = url.searchParams.get('text')?.trim();
    const type = url.searchParams.get('type')?.trim().toLowerCase();
    return successResponse(200, 'SUCCESS', await listCandidates(env, passageId, text, type), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreatePassageSentenceLexical(
  request: Request,
  env: Env,
  origin: string,
  passageId: string,
  sentenceId: string,
): Promise<Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const context = await getSentenceAuthoringContext(env, sentenceId, passageId);
  if (!context) return errorResponse(404, 'NOT_FOUND', 'Sentence không thuộc passage này', origin);
  const tokenIndexes = validateTokenIndexes(body.token_indexes, context.tokens.length);
  if (typeof tokenIndexes === 'string') return errorResponse(400, 'VALIDATION_ERROR', tokenIndexes, origin);
  const position = body.position === undefined
    ? null
    : Number.isSafeInteger(body.position) && (body.position as number) >= 0
      ? body.position as number
      : -1;
  if (position === -1) return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
  if (typeof body.lexical !== 'object' || body.lexical === null || Array.isArray(body.lexical)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'lexical phải là JSON object', origin);
  }
  const lexical = await readLexicalInput(new Request('https://internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body.lexical),
  }), origin);
  if (isResponse(lexical)) return lexical;

  try {
    const candidates = await listCandidates(env, passageId, lexical.text, lexical.type);
    if (candidates.length > 0 && body.allow_duplicate !== true) {
      return errorResponse(409, 'CONFLICT', {
        reason: 'LEXICAL_CANDIDATES_EXIST',
        message: 'Hãy chọn reuse một lexical hiện có hoặc xác nhận tạo nghĩa ngữ cảnh mới.',
        candidates,
      }, origin);
    }
    const lexicalId = generateUUIDv7();
    const mappingId = generateUUIDv7();
    const mappingPosition = position ?? Number((await env.DB.prepare(`
      SELECT COUNT(*) AS total FROM sentence_lexicals WHERE sentence_id = ?
    `).bind(sentenceId).first<{ total: number }>())?.total ?? 0);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO lexicals (id, text, type, translations, phonemes, audio, image)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        lexicalId,
        lexical.text,
        lexical.type,
        JSON.stringify(lexical.translations),
        lexical.phonemes,
        lexical.audio,
        lexical.image,
      ),
      env.DB.prepare(`
        INSERT INTO sentence_lexicals (id, sentence_id, lexical_id, position, token_indexes)
        VALUES (?, ?, ?, ?, ?)
      `).bind(mappingId, sentenceId, lexicalId, mappingPosition, JSON.stringify(tokenIndexes)),
      ...invalidateRuntimeStatements(env, [passageId]),
    ]);
    return successResponse(201, 'CREATED', {
      id: mappingId,
      sentence_id: sentenceId,
      position: mappingPosition,
      token_indexes: tokenIndexes,
      lexical: { id: lexicalId, ...lexical },
      runtime_invalidated: true,
    }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleReusePassageSentenceLexical(
  request: Request,
  env: Env,
  origin: string,
  passageId: string,
  sentenceId: string,
): Promise<Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const context = await getSentenceAuthoringContext(env, sentenceId, passageId);
  if (!context) return errorResponse(404, 'NOT_FOUND', 'Sentence không thuộc passage này', origin);
  const lexicalId = typeof body.lexical_id === 'string' ? body.lexical_id.trim() : '';
  if (!lexicalId) return errorResponse(400, 'VALIDATION_ERROR', 'lexical_id không được để trống', origin);
  const tokenIndexes = validateTokenIndexes(body.token_indexes, context.tokens.length);
  if (typeof tokenIndexes === 'string') return errorResponse(400, 'VALIDATION_ERROR', tokenIndexes, origin);
  const position = body.position === undefined
    ? null
    : Number.isSafeInteger(body.position) && (body.position as number) >= 0
      ? body.position as number
      : -1;
  if (position === -1) return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);

  try {
    const lexical = await env.DB.prepare(`
      SELECT lexical.id, lexical.text, lexical.type, lexical.translations,
             lexical.phonemes, lexical.audio, lexical.image
      FROM lexicals lexical
      JOIN passage_lexicals owner ON owner.lexical_id = lexical.id
      WHERE owner.passage_id = ? AND lexical.id = ?
    `).bind(passageId, lexicalId).first<{
      id: string;
      text: string;
      type: string;
      translations: string;
      phonemes: string | null;
      audio: string | null;
      image: string | null;
    }>();
    if (!lexical) return errorResponse(409, 'CONFLICT', 'Lexical không thuộc passage này; hãy tạo lexical mới', origin);
    const mappingPosition = position ?? Number((await env.DB.prepare(`
      SELECT COUNT(*) AS total FROM sentence_lexicals WHERE sentence_id = ?
    `).bind(sentenceId).first<{ total: number }>())?.total ?? 0);
    const mappingId = generateUUIDv7();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO sentence_lexicals (id, sentence_id, lexical_id, position, token_indexes)
        VALUES (?, ?, ?, ?, ?)
      `).bind(mappingId, sentenceId, lexicalId, mappingPosition, JSON.stringify(tokenIndexes)),
      ...invalidateRuntimeStatements(env, [passageId]),
    ]);
    return successResponse(201, 'CREATED', {
      id: mappingId,
      sentence_id: sentenceId,
      position: mappingPosition,
      token_indexes: tokenIndexes,
      lexical: { ...lexical, translations: parseTranslations(lexical.translations) },
      runtime_invalidated: true,
    }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
