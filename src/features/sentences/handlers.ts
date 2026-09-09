import { successResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { generateUUIDv7 } from '../../utils/uuid';
import type { PronunciationSource, Sentence, SentenceLexical, SentenceLexicalRow, SentencePronunciation, SentenceRow } from './types';
import { parseOptionalMediaUrl } from '../../utils/media';
import {
  deleteOrphanLexicalStatements,
  getSentenceAuthoringContext,
  invalidateRuntimeStatements,
  parseStoredTokenIndexes,
  passageIdsForSentence,
  validateTokenIndexes,
} from '../authoring/context';
import {
  deleteAssetKeys,
  entityAssetKeys,
  orphanLexicalIdsAfterMappingDeletion,
  orphanLexicalIdsAfterSentenceDeletion,
} from '../media/assets';

const TEMPORARY_POSITION_OFFSET = 1_000_000;

interface SentenceInput {
  text: string;
  tokens: string[];
  translations: Record<string, string> | null;
  phonemes: string | null;
  pronunciations: SentencePronunciation[];
  audio: string | null;
  image: string | null;
}

interface LexicalPronunciationInput {
  lexical_id: string;
  phonemes: string;
}

const PRONUNCIATION_SOURCES = new Set<PronunciationSource>(['single', 'rule', 'policy', 'manual']);
const CMU_TOKEN_PATTERN = /^[A-Z]+[012]?$/u;
const WORD_TOKEN_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/u;

interface SentenceLexicalInput {
  lexical_id: string;
  position: number;
  token_indexes: number[];
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

function normalizeCmu(value: string): string | null {
  const tokens = value.split(/[\s,]+/u).map(token => token.trim().toUpperCase()).filter(token => token && token !== '-');
  return tokens.length > 0 && tokens.every(token => CMU_TOKEN_PATTERN.test(token)) ? tokens.join(' ') : null;
}

function normalizeLexicalCmu(value: string): string | null {
  const wrappedGroups = [...value.matchAll(/\/\s*([^/]+?)\s*\//gu)].map(match => normalizeCmu(match[1] ?? '')).filter((group): group is string => Boolean(group));
  if (wrappedGroups.length > 0) return wrappedGroups.map(group => `/${group}/`).join(' ');
  const groups = value.split(/\s*-\s*/u).map(group => normalizeCmu(group)).filter((group): group is string => Boolean(group));
  return groups.length > 0 ? groups.map(group => `/${group}/`).join(' ') : null;
}

function readPronunciations(value: unknown, tokens: string[]): SentencePronunciation[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const result: SentencePronunciation[] = [];
  const indexes = new Set<number>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    const tokenIndex = raw.token_index;
    const text = typeof raw.text === 'string' ? raw.text : '';
    const variant = raw.variant;
    const source = raw.source;
    const phonemes = typeof raw.phonemes === 'string' ? normalizeCmu(raw.phonemes) : null;
    if (!Number.isSafeInteger(tokenIndex) || (tokenIndex as number) < 0 || (tokenIndex as number) >= tokens.length || indexes.has(tokenIndex as number)) return null;
    if (text !== tokens[tokenIndex as number] || !WORD_TOKEN_PATTERN.test(text) || !phonemes) return null;
    if (variant !== null && (!Number.isSafeInteger(variant) || (variant as number) < 0)) return null;
    if (typeof source !== 'string' || !PRONUNCIATION_SOURCES.has(source as PronunciationSource)) return null;
    indexes.add(tokenIndex as number);
    result.push({ token_index: tokenIndex as number, text, variant: variant as number | null, phonemes, source: source as PronunciationSource });
  }
  return result.sort((left, right) => left.token_index - right.token_index);
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
    pronunciations: readPronunciations(parseJson<unknown>(row.pronunciations, []), Array.isArray(tokens) ? tokens as string[] : []) ?? [],
    audio: row.audio,
    image: row.image,
  };
}

function parseSentenceLexical(row: SentenceLexicalRow): SentenceLexical {
  return {
    ...row,
    token_indexes: parseStoredTokenIndexes(row.token_indexes),
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
  const pronunciations = readPronunciations(value.pronunciations, tokens as string[]);
  if (!pronunciations) return errorResponse(400, 'VALIDATION_ERROR', 'pronunciations phải khớp chính xác với sentence tokens và dùng CMU hợp lệ', origin);
  const audio = parseOptionalMediaUrl(value.audio, 'audio', origin);
  if (isResponse(audio)) return audio;
  const image = parseOptionalMediaUrl(value.image, 'image', origin);
  if (isResponse(image)) return image;
  return {
    text,
    tokens,
    translations: value.translations === null || value.translations === undefined ? null : value.translations as Record<string, string>,
    phonemes: typeof value.phonemes === 'string' ? value.phonemes.trim() || null : null,
    pronunciations,
    audio: audio ?? null,
    image: image ?? null,
  };
}

async function readSentenceLexicalInput(
  request: Request,
  origin: string,
  tokenCount: number,
): Promise<SentenceLexicalInput | Response> {
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
  const tokenIndexes = validateTokenIndexes(value.token_indexes, tokenCount);
  const position = typeof value.position === 'number' && Number.isSafeInteger(value.position) && value.position >= 0
    ? value.position
    : -1;
  if (!lexicalId) return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu lexical_id', origin);
  if (typeof tokenIndexes === 'string') return errorResponse(400, 'VALIDATION_ERROR', tokenIndexes, origin);
  if (position === -1) return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
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

export async function handleCreatePassageParagraphSentence(
  request: Request,
  env: Env,
  origin: string,
  passageId: string,
  paragraphId: string,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.clone().json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  const requestedPosition = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).position
    : undefined;
  if (requestedPosition !== undefined && (!Number.isSafeInteger(requestedPosition) || (requestedPosition as number) < 0)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
  }
  const input = await readSentenceInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const paragraph = await env.DB.prepare(`
      SELECT id FROM paragraphs WHERE id = ? AND passage_id = ?
    `).bind(paragraphId, passageId).first<{ id: string }>();
    if (!paragraph) return errorResponse(404, 'NOT_FOUND', 'Paragraph không thuộc passage này', origin);
    const rows = await env.DB.prepare(`
      SELECT id FROM paragraph_sentences WHERE paragraph_id = ? ORDER BY position, id
    `).bind(paragraphId).all<{ id: string }>();
    const position = requestedPosition === undefined ? rows.results.length : requestedPosition as number;
    if (position > rows.results.length) {
      return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số sentence hiện có', origin);
    }
    const sentenceId = generateUUIDv7();
    const mappingId = generateUUIDv7();
    const orderedIds = [
      ...rows.results.slice(0, position).map(row => row.id),
      mappingId,
      ...rows.results.slice(position).map(row => row.id),
    ];
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO sentences (id, text, tokens, translations, phonemes, pronunciations, audio, image)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sentenceId,
        input.text,
        JSON.stringify(input.tokens),
        input.translations ? JSON.stringify(input.translations) : null,
        input.phonemes,
        input.pronunciations.length ? JSON.stringify(input.pronunciations) : null,
        input.audio,
        input.image,
      ),
      env.DB.prepare(`
        UPDATE paragraph_sentences SET position = position + ${TEMPORARY_POSITION_OFFSET}
        WHERE paragraph_id = ?
      `).bind(paragraphId),
      env.DB.prepare(`
        INSERT INTO paragraph_sentences (id, paragraph_id, sentence_id, position)
        VALUES (?, ?, ?, ${TEMPORARY_POSITION_OFFSET - 1})
      `).bind(mappingId, paragraphId, sentenceId),
      ...orderedIds.map((id, finalPosition) => (
        env.DB.prepare('UPDATE paragraph_sentences SET position = ? WHERE id = ?').bind(finalPosition, id)
      )),
      ...invalidateRuntimeStatements(env, [passageId]),
    ]);
    return successResponse(201, 'CREATED', {
      id: mappingId,
      position,
      sentence: { id: sentenceId, ...input, lexicals: [] },
      runtime_invalidated: true,
    }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateSentence(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  let options: unknown;
  try {
    options = await request.clone().json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  const dropInvalidMappings = typeof options === 'object'
    && options !== null
    && !Array.isArray(options)
    && (options as Record<string, unknown>).drop_invalid_mappings === true;
  const input = await readSentenceInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const passageIds = await passageIdsForSentence(env, id);
    const existing = await env.DB.prepare('SELECT * FROM sentences WHERE id = ?').bind(id).first<SentenceRow>();
    if (!existing) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const mappings = await env.DB.prepare(`
      SELECT id, lexical_id, token_indexes FROM sentence_lexicals WHERE sentence_id = ?
    `).bind(id).all<{ id: string; lexical_id: string; token_indexes: string }>();
    const invalidMappings = mappings.results
      .filter(mapping => parseStoredTokenIndexes(mapping.token_indexes).some(index => index >= input.tokens.length));
    const invalidMappingIds = invalidMappings.map(mapping => mapping.id);
    if (invalidMappingIds.length > 0 && !dropInvalidMappings) {
      return errorResponse(409, 'CONFLICT', {
        reason: 'TOKEN_MAPPINGS_OUT_OF_RANGE',
        mapping_ids: invalidMappingIds,
        message: 'Hãy sửa mapping trước hoặc gửi drop_invalid_mappings=true để xóa mapping không còn hợp lệ.',
      }, origin);
    }
    const orphanLexicalIds = await orphanLexicalIdsAfterMappingDeletion(
      env,
      invalidMappings.map(mapping => mapping.lexical_id),
      invalidMappingIds,
    );
    const serializedTokens = JSON.stringify(input.tokens);
    const contentChanged = existing.text !== input.text || existing.tokens !== serializedTokens;
    if (contentChanged && existing.audio) await deleteAssetKeys(env, entityAssetKeys('sentences', id).filter(key => key.endsWith('/audio.opus')));
    const nextPhonemes = contentChanged ? null : input.phonemes;
    const nextPronunciations = contentChanged ? [] : input.pronunciations;
    const nextAudio = contentChanged ? null : input.audio;
    await deleteAssetKeys(env, orphanLexicalIds.flatMap(lexicalId => entityAssetKeys('lexicals', lexicalId)));
    await env.DB.batch([
      env.DB.prepare('UPDATE sentences SET text = ?, tokens = ?, translations = ?, phonemes = ?, pronunciations = ?, audio = ?, image = ? WHERE id = ?')
        .bind(input.text, serializedTokens, input.translations ? JSON.stringify(input.translations) : null, nextPhonemes, nextPronunciations.length ? JSON.stringify(nextPronunciations) : null, nextAudio, input.image, id),
      ...invalidMappingIds.map(mappingId => env.DB.prepare('DELETE FROM sentence_lexicals WHERE id = ?').bind(mappingId)),
      ...deleteOrphanLexicalStatements(env, invalidMappings.map(mapping => mapping.lexical_id)),
      ...invalidateRuntimeStatements(env, passageIds),
    ]);
    return successResponse(200, 'UPDATED', { id, ...input, phonemes: nextPhonemes, pronunciations: nextPronunciations, audio: nextAudio }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateSentencePronunciations(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu pronunciation không hợp lệ', origin);
  try {
    const sentence = await env.DB.prepare('SELECT * FROM sentences WHERE id = ?').bind(id).first<SentenceRow>();
    if (!sentence) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const tokens = parseJson<unknown>(sentence.tokens, []);
    if (!Array.isArray(tokens) || !tokens.every(token => typeof token === 'string')) return errorResponse(409, 'CONFLICT', 'Sentence tokens không hợp lệ', origin);
    const value = body as Record<string, unknown>;
    const pronunciations = readPronunciations(value.pronunciations, tokens);
    if (!pronunciations) return errorResponse(400, 'VALIDATION_ERROR', 'pronunciations phải khớp chính xác với sentence tokens và dùng CMU hợp lệ', origin);
    const expectedIndexes = tokens.map((token, tokenIndex) => WORD_TOKEN_PATTERN.test(token) ? tokenIndex : -1).filter(tokenIndex => tokenIndex >= 0);
    if (pronunciations.length !== expectedIndexes.length || expectedIndexes.some((tokenIndex, index) => pronunciations[index]?.token_index !== tokenIndex)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'pronunciations phải bao phủ tất cả word tokens của sentence', origin);
    }
    const rawLexicals = value.lexicals;
    if (!Array.isArray(rawLexicals)) return errorResponse(400, 'VALIDATION_ERROR', 'lexicals phải là một mảng', origin);
    const lexicalInputs: LexicalPronunciationInput[] = [];
    const lexicalIds = new Set<string>();
    for (const item of rawLexicals) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return errorResponse(400, 'VALIDATION_ERROR', 'Lexical pronunciation không hợp lệ', origin);
      const raw = item as Record<string, unknown>;
      const lexicalId = typeof raw.lexical_id === 'string' ? raw.lexical_id.trim() : '';
      const phonemes = typeof raw.phonemes === 'string' ? normalizeLexicalCmu(raw.phonemes) : null;
      if (!lexicalId || lexicalIds.has(lexicalId) || !phonemes) return errorResponse(400, 'VALIDATION_ERROR', 'Lexical pronunciation bị trùng hoặc không dùng CMU hợp lệ', origin);
      lexicalIds.add(lexicalId);
      lexicalInputs.push({ lexical_id: lexicalId, phonemes });
    }
    if (lexicalInputs.length) {
      const placeholders = lexicalInputs.map(() => '?').join(', ');
      const mapped = await env.DB.prepare(`SELECT DISTINCT lexical_id FROM sentence_lexicals WHERE sentence_id = ? AND lexical_id IN (${placeholders})`)
        .bind(id, ...lexicalInputs.map(item => item.lexical_id)).all<{ lexical_id: string }>();
      const mappedIds = new Set(mapped.results.map(row => row.lexical_id));
      if (lexicalInputs.some(item => !mappedIds.has(item.lexical_id))) return errorResponse(400, 'VALIDATION_ERROR', 'Lexical không thuộc sentence này', origin);
    }
    const nextPhonemes = pronunciations.map(item => item.phonemes).join(' ');
    const pronunciationChanged = sentence.phonemes !== nextPhonemes || sentence.pronunciations !== JSON.stringify(pronunciations);
    const overwriteLexicals = value.overwrite_lexicals === true;
    const lexicalRows = lexicalInputs.length
      ? await env.DB.prepare(`SELECT id, audio FROM lexicals WHERE id IN (${lexicalInputs.map(() => '?').join(', ')})${overwriteLexicals ? '' : ' AND phonemes IS NULL'}`).bind(...lexicalInputs.map(item => item.lexical_id)).all<{ id: string; audio: string | null }>()
      : { results: [] as Array<{ id: string; audio: string | null }> };
    await deleteAssetKeys(env, [
      ...(pronunciationChanged && sentence.audio ? entityAssetKeys('sentences', id).filter(key => key.endsWith('/audio.opus')) : []),
      ...lexicalRows.results.filter(row => row.audio).flatMap(row => entityAssetKeys('lexicals', row.id).filter(key => key.endsWith('/audio.opus'))),
    ]);
    const passageIds = await passageIdsForSentence(env, id);
    await env.DB.batch([
      env.DB.prepare('UPDATE sentences SET pronunciations = ?, phonemes = ?, audio = ? WHERE id = ?')
        .bind(JSON.stringify(pronunciations), nextPhonemes, pronunciationChanged ? null : sentence.audio, id),
      ...lexicalInputs.map(item => env.DB.prepare(`UPDATE lexicals SET phonemes = ?, audio = NULL WHERE id = ?${overwriteLexicals ? '' : ' AND phonemes IS NULL'}`).bind(item.phonemes, item.lexical_id)),
      ...invalidateRuntimeStatements(env, passageIds),
    ]);
    return successResponse(200, 'UPDATED', {
      sentence_id: id,
      pronunciations,
      phonemes: nextPhonemes,
      audio: pronunciationChanged ? null : sentence.audio,
      inherited_lexicals: lexicalRows.results.length,
      runtime_invalidated: passageIds.length > 0,
    }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteSentence(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const existing = await env.DB.prepare('SELECT id FROM sentences WHERE id = ?').bind(id).first<{ id: string }>();
    if (!existing) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const owner = await env.DB.prepare('SELECT passage_id FROM sentence_passages WHERE sentence_id = ?')
      .bind(id).first<{ passage_id: string }>();
    if (owner) return errorResponse(409, 'CONFLICT', 'Không thể xóa sentence đang được passage sử dụng', origin);
    const lexicalRows = await env.DB.prepare(`
      SELECT DISTINCT lexical_id FROM sentence_lexicals WHERE sentence_id = ?
    `).bind(id).all<{ lexical_id: string }>();
    const lexicalIds = lexicalRows.results.map(row => row.lexical_id);
    const orphanLexicalIds = await orphanLexicalIdsAfterSentenceDeletion(env, lexicalIds, [id]);
    await deleteAssetKeys(env, [
      ...entityAssetKeys('sentences', id),
      ...orphanLexicalIds.flatMap(lexicalId => entityAssetKeys('lexicals', lexicalId)),
    ]);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sentences WHERE id = ?').bind(id),
      ...deleteOrphanLexicalStatements(env, lexicalIds),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'Không thể xóa sentence đang được lexical hoặc paragraph sử dụng', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListSentenceLexicals(env: Env, origin: string, sentenceId: string): Promise<Response> {
  try {
    const sentence = await env.DB.prepare('SELECT id FROM sentences WHERE id = ?').bind(sentenceId).first<{ id: string }>();
    if (!sentence) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const rows = await env.DB.prepare('SELECT * FROM sentence_lexicals WHERE sentence_id = ? ORDER BY position ASC, id ASC').bind(sentenceId).all<SentenceLexicalRow>();
    return successResponse(200, 'SUCCESS', rows.results.map(parseSentenceLexical), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateSentenceLexical(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT sentence_id, lexical_id FROM sentence_lexicals WHERE id = ?').bind(id).first<{ sentence_id: string; lexical_id: string }>();
  if (!existing) return errorResponse(404, 'NOT_FOUND', undefined, origin);
  const context = await getSentenceAuthoringContext(env, existing.sentence_id);
  if (!context) return errorResponse(409, 'CONFLICT', 'Sentence mapping không thuộc passage nào', origin);
  const input = await readSentenceLexicalInput(request, origin, context.tokens.length);
  if (isResponse(input)) return input;
  try {
    const lexicalInPassage = await env.DB.prepare(`
      SELECT 1 FROM passage_lexicals WHERE passage_id = ? AND lexical_id = ?
    `).bind(context.passageId, input.lexical_id).first<{ 1: number }>();
    if (!lexicalInPassage) {
      return errorResponse(409, 'CONFLICT', 'Chỉ được map lexical đã thuộc passage này', origin);
    }
    const orphanLexicalIds = input.lexical_id === existing.lexical_id
      ? []
      : await orphanLexicalIdsAfterMappingDeletion(env, [existing.lexical_id], [id]);
    await deleteAssetKeys(env, orphanLexicalIds.flatMap(lexicalId => entityAssetKeys('lexicals', lexicalId)));
    await env.DB.batch([
      env.DB.prepare('UPDATE sentence_lexicals SET lexical_id = ?, position = ?, token_indexes = ? WHERE id = ?')
        .bind(input.lexical_id, input.position, JSON.stringify(input.token_indexes), id),
      ...deleteOrphanLexicalStatements(env, [existing.lexical_id]),
      ...invalidateRuntimeStatements(env, [context.passageId]),
    ]);
    return successResponse(200, 'UPDATED', { id, sentence_id: existing.sentence_id, ...input }, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'sentence_id hoặc lexical_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteSentenceLexical(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const mapping = await env.DB.prepare('SELECT sentence_id, lexical_id FROM sentence_lexicals WHERE id = ?').bind(id).first<{ sentence_id: string; lexical_id: string }>();
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const passageIds = await passageIdsForSentence(env, mapping.sentence_id);
    const orphanLexicalIds = await orphanLexicalIdsAfterMappingDeletion(env, [mapping.lexical_id], [id]);
    await deleteAssetKeys(env, orphanLexicalIds.flatMap(lexicalId => entityAssetKeys('lexicals', lexicalId)));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sentence_lexicals WHERE id = ?').bind(id),
      ...deleteOrphanLexicalStatements(env, [mapping.lexical_id]),
      ...invalidateRuntimeStatements(env, passageIds),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
