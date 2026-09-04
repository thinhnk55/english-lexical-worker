import { successResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { generateUUIDv7 } from '../../utils/uuid';
import { parseOptionalMediaUrl } from '../../utils/media';

interface PassageRow {
  id: string;
  title_sentence_id: string;
  image: string | null;
}

interface PassageRuntimeRow {
  payload: string;
  updated_at: number;
}

interface ParagraphRow {
  id: string;
  passage_id: string;
  position: number;
  image: string | null;
}

interface SentenceRow {
  id: string;
  text: string;
  tokens: string | null;
  translations: string | null;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
}

interface ParagraphSentenceRow extends SentenceRow {
  paragraph_sentence_id: string;
  position: number;
}

interface SentenceLexicalRuntimeRow {
  id: string;
  sentence_id: string;
  position: number | null;
  token_indexes: string | null;
  lexical_id: string;
  text: string;
  type: string;
  translations: string;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
}

interface PassageInput {
  title_sentence_id: string;
  image?: string | null;
}

interface PositionInput {
  position?: number;
  image?: string | null;
}

interface ParagraphSentenceInput {
  sentence_id: string;
  position?: number;
}

const TEMPORARY_POSITION_OFFSET = 1_000_000;

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isForeignKeyConstraint(error: unknown): boolean {
  return error instanceof Error && /foreign key/i.test(error.message);
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
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

function parseSentence(row: SentenceRow) {
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

function parseLexical(row: SentenceLexicalRuntimeRow) {
  const translations = parseJson<unknown>(row.translations, {});
  return {
    id: row.lexical_id,
    text: row.text,
    type: row.type,
    translations: isTranslationMap(translations) ? translations : {},
    phonemes: row.phonemes,
    audio: row.audio,
    image: row.image,
  };
}

async function getSentenceDetail(env: Env, sentence: SentenceRow) {
  const lexicalRows = await env.DB.prepare(`
    SELECT
      sentence_lexicals.id,
      sentence_lexicals.sentence_id,
      sentence_lexicals.position,
      sentence_lexicals.token_indexes,
      lexicals.id AS lexical_id,
      lexicals.text,
      lexicals.type,
      lexicals.translations,
      lexicals.phonemes,
      lexicals.audio,
      lexicals.image
    FROM sentence_lexicals
    INNER JOIN lexicals ON lexicals.id = sentence_lexicals.lexical_id
    WHERE sentence_lexicals.sentence_id = ?
    ORDER BY sentence_lexicals.position ASC, sentence_lexicals.id ASC
  `).bind(sentence.id).all<SentenceLexicalRuntimeRow>();
  return {
    ...parseSentence(sentence),
    lexicals: lexicalRows.results.map(row => ({
      id: row.id,
      position: row.position,
      token_indexes: row.token_indexes,
      lexical: parseLexical(row),
    })),
  };
}

async function readBody(request: Request, origin: string): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', origin);
  }
  return body as Record<string, unknown>;
}

async function readPassageInput(request: Request, origin: string): Promise<PassageInput | Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const titleSentenceId = typeof body.title_sentence_id === 'string' ? body.title_sentence_id.trim() : '';
  if (!titleSentenceId) return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu title_sentence_id', origin);
  const image = parseOptionalMediaUrl(body.image, 'image', origin);
  if (isResponse(image)) return image;
  return image === undefined ? { title_sentence_id: titleSentenceId } : { title_sentence_id: titleSentenceId, image };
}

function parsePosition(value: unknown, origin: string, required: boolean): number | undefined | Response {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
  }
  return value;
}

async function readPositionInput(request: Request, origin: string, required = false): Promise<PositionInput | Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const position = parsePosition(body.position, origin, required);
  if (isResponse(position)) return position;
  const image = parseOptionalMediaUrl(body.image, 'image', origin);
  if (isResponse(image)) return image;
  return {
    ...(position === undefined ? {} : { position }),
    ...(image === undefined ? {} : { image }),
  };
}

async function readParagraphSentenceInput(request: Request, origin: string, requirePosition = false): Promise<ParagraphSentenceInput | Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const sentenceId = typeof body.sentence_id === 'string' ? body.sentence_id.trim() : '';
  if (!sentenceId) return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu sentence_id', origin);
  const position = parsePosition(body.position, origin, requirePosition);
  if (isResponse(position)) return position;
  return position === undefined ? { sentence_id: sentenceId } : { sentence_id: sentenceId, position };
}

async function getPassage(env: Env, id: string): Promise<PassageRow | null> {
  return env.DB.prepare('SELECT id, title_sentence_id, image FROM passages WHERE id = ?').bind(id).first<PassageRow>();
}

async function getParagraph(env: Env, id: string): Promise<ParagraphRow | null> {
  return env.DB.prepare('SELECT id, passage_id, position, image FROM paragraphs WHERE id = ?').bind(id).first<ParagraphRow>();
}

async function paragraphIds(env: Env, passageId: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT id FROM paragraphs WHERE passage_id = ? ORDER BY position ASC').bind(passageId).all<{ id: string }>();
  return rows.results.map(row => row.id);
}

async function paragraphSentenceIds(env: Env, paragraphId: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT id FROM paragraph_sentences WHERE paragraph_id = ? ORDER BY position ASC').bind(paragraphId).all<{ id: string }>();
  return rows.results.map(row => row.id);
}

function orderStatements(env: Env, table: 'paragraphs' | 'paragraph_sentences', parentColumn: 'passage_id' | 'paragraph_id', parentId: string, ids: string[]): D1PreparedStatement[] {
  if (ids.length === 0) return [];
  return [
    env.DB.prepare(`UPDATE ${table} SET position = position + ${TEMPORARY_POSITION_OFFSET} WHERE ${parentColumn} = ?`).bind(parentId),
    ...ids.map((id, position) => env.DB.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).bind(position, id)),
  ];
}

function insertAt(ids: string[], id: string, position: number): string[] {
  return [...ids.slice(0, position), id, ...ids.slice(position)];
}

async function getParagraphDetail(env: Env, paragraph: ParagraphRow) {
  const rows = await env.DB.prepare(`
    SELECT
      paragraph_sentences.id AS paragraph_sentence_id,
      paragraph_sentences.position,
      sentences.id,
      sentences.text,
      sentences.tokens,
      sentences.translations,
      sentences.phonemes,
      sentences.audio,
      sentences.image
    FROM paragraph_sentences
    INNER JOIN sentences ON sentences.id = paragraph_sentences.sentence_id
    WHERE paragraph_sentences.paragraph_id = ?
    ORDER BY paragraph_sentences.position ASC
  `).bind(paragraph.id).all<ParagraphSentenceRow>();
  return {
    id: paragraph.id,
    passage_id: paragraph.passage_id,
    position: paragraph.position,
    image: paragraph.image,
    sentences: await Promise.all(rows.results.map(async row => ({
      id: row.paragraph_sentence_id,
      position: row.position,
      sentence: await getSentenceDetail(env, row),
    }))),
  };
}

async function getPassageDetail(env: Env, passage: PassageRow) {
  const titleSentence = await env.DB.prepare('SELECT id, text, tokens, translations, phonemes, audio, image FROM sentences WHERE id = ?')
    .bind(passage.title_sentence_id)
    .first<SentenceRow>();
  if (!titleSentence) throw new Error('Passage title sentence not found');
  const rows = await env.DB.prepare('SELECT id, passage_id, position, image FROM paragraphs WHERE passage_id = ? ORDER BY position ASC')
    .all<ParagraphRow>();
  return {
    id: passage.id,
    image: passage.image,
    title: await getSentenceDetail(env, titleSentence),
    paragraphs: await Promise.all(rows.results.map(paragraph => getParagraphDetail(env, paragraph))),
  };
}

async function publishPassageRuntime(env: Env, passageId: string) {
  const passage = await getPassage(env, passageId);
  if (!passage) throw new Error('Passage not found while publishing runtime');
  const payload = await getPassageDetail(env, passage);
  await env.DB.prepare(`
    INSERT INTO passages_runtime (passage_id, payload, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(passage_id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = unixepoch()
  `).bind(passageId, JSON.stringify(payload)).run();
  return payload;
}

export async function handlePublishPassageRuntime(env: Env, origin: string, passageId: string): Promise<Response> {
  try {
    if (!await getPassage(env, passageId)) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'UPDATED', await publishPassageRuntime(env, passageId), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeletePassageRuntime(env: Env, origin: string, passageId: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM passages_runtime WHERE passage_id = ?').bind(passageId).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetPassageRuntime(env: Env, origin: string, passageId: string): Promise<Response> {
  try {
    const row = await env.DB.prepare('SELECT payload, updated_at FROM passages_runtime WHERE passage_id = ?')
      .bind(passageId)
      .first<PassageRuntimeRow>();
    if (!row) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      return errorResponse(500, 'INTERNAL_ERROR', 'Passage runtime không hợp lệ', origin);
    }
    return successResponse(200, 'SUCCESS', { ...(payload as object), updated_at: row.updated_at }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListPassages(request: Request, env: Env, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { page, size, offset } = parsePagination(url);
    const text = url.searchParams.get('text')?.trim().toLowerCase();
    const where = text ? 'WHERE LOWER(sentences.text) LIKE ?' : '';
    const params = text ? [`%${text}%`] : [];
    const count = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM passages
      INNER JOIN sentences ON sentences.id = passages.title_sentence_id
      ${where}
    `).bind(...params).first<{ total: number }>();
    const rows = await env.DB.prepare(`
      SELECT passages.id, passages.title_sentence_id, passages.image, sentences.text AS title_text
      FROM passages
      INNER JOIN sentences ON sentences.id = passages.title_sentence_id
      ${where}
      ORDER BY sentences.text ASC, passages.id ASC
      LIMIT ? OFFSET ?
    `)
      .bind(...params, size, offset)
      .all<PassageRow & { title_text: string }>();
    return successResponse(200, 'SUCCESS', rows.results.map(row => ({
      id: row.id,
      title_sentence_id: row.title_sentence_id,
      title: row.title_text,
      image: row.image,
    })), origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetPassage(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const passage = await getPassage(env, id);
    if (!passage) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', await getPassageDetail(env, passage), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreatePassage(request: Request, env: Env, origin: string): Promise<Response> {
  const input = await readPassageInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    await env.DB.prepare('INSERT INTO passages (id, title_sentence_id, image) VALUES (?, ?, ?)').bind(id, input.title_sentence_id, input.image ?? null).run();
    const passage = await getPassage(env, id);
    return successResponse(201, 'CREATED', passage ? await getPassageDetail(env, passage) : undefined, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'title_sentence_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdatePassage(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readPassageInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = input.image === undefined
      ? await env.DB.prepare('UPDATE passages SET title_sentence_id = ? WHERE id = ?').bind(input.title_sentence_id, id).run()
      : await env.DB.prepare('UPDATE passages SET title_sentence_id = ?, image = ? WHERE id = ?').bind(input.title_sentence_id, input.image, id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const passage = await getPassage(env, id);
    return successResponse(200, 'UPDATED', passage ? await getPassageDetail(env, passage) : undefined, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'title_sentence_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeletePassage(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM passages WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListPassageParagraphs(env: Env, origin: string, passageId: string): Promise<Response> {
  try {
    if (!await getPassage(env, passageId)) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const rows = await env.DB.prepare('SELECT id, passage_id, position, image FROM paragraphs WHERE passage_id = ? ORDER BY position ASC')
      .bind(passageId)
      .all<ParagraphRow>();
    return successResponse(200, 'SUCCESS', await Promise.all(rows.results.map(paragraph => getParagraphDetail(env, paragraph))), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateParagraph(request: Request, env: Env, origin: string, passageId: string): Promise<Response> {
  const input = await readPositionInput(request, origin);
  if (isResponse(input)) return input;
  try {
    if (!await getPassage(env, passageId)) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = await paragraphIds(env, passageId);
    const position = input.position ?? ids.length;
    if (position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số paragraph hiện có', origin);
    const id = generateUUIDv7();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO paragraphs (id, passage_id, position, image) VALUES (?, ?, -1, ?)').bind(id, passageId, input.image ?? null),
      ...orderStatements(env, 'paragraphs', 'passage_id', passageId, insertAt(ids, id, position)),
    ]);
    const paragraph = await getParagraph(env, id);
    return successResponse(201, 'CREATED', paragraph ? await getParagraphDetail(env, paragraph) : undefined, origin);
  } catch (error) {
    if (isUniqueConstraint(error)) return errorResponse(409, 'CONFLICT', 'position paragraph đã tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetParagraph(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const paragraph = await getParagraph(env, id);
    if (!paragraph) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'SUCCESS', await getParagraphDetail(env, paragraph), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateParagraph(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readPositionInput(request, origin, true);
  if (isResponse(input) || input.position === undefined) return isResponse(input) ? input : errorResponse(400, 'VALIDATION_ERROR', 'Thiếu position', origin);
  try {
    const paragraph = await getParagraph(env, id);
    if (!paragraph) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await paragraphIds(env, paragraph.passage_id)).filter(paragraphId => paragraphId !== id);
    if (input.position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số paragraph hiện có', origin);
    const statements = orderStatements(env, 'paragraphs', 'passage_id', paragraph.passage_id, insertAt(ids, id, input.position!));
    if (input.image !== undefined) statements.push(env.DB.prepare('UPDATE paragraphs SET image = ? WHERE id = ?').bind(input.image, id));
    await env.DB.batch(statements);
    const updated = await getParagraph(env, id);
    return successResponse(200, 'UPDATED', updated ? await getParagraphDetail(env, updated) : undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteParagraph(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const paragraph = await getParagraph(env, id);
    if (!paragraph) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await paragraphIds(env, paragraph.passage_id)).filter(paragraphId => paragraphId !== id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM paragraphs WHERE id = ?').bind(id),
      ...orderStatements(env, 'paragraphs', 'passage_id', paragraph.passage_id, ids),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleListParagraphSentences(env: Env, origin: string, paragraphId: string): Promise<Response> {
  try {
    const paragraph = await getParagraph(env, paragraphId);
    if (!paragraph) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const detail = await getParagraphDetail(env, paragraph);
    return successResponse(200, 'SUCCESS', detail.sentences, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateParagraphSentence(request: Request, env: Env, origin: string, paragraphId: string): Promise<Response> {
  const input = await readParagraphSentenceInput(request, origin);
  if (isResponse(input)) return input;
  try {
    if (!await getParagraph(env, paragraphId)) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = await paragraphSentenceIds(env, paragraphId);
    const position = input.position ?? ids.length;
    if (position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số câu hiện có', origin);
    const id = generateUUIDv7();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO paragraph_sentences (id, paragraph_id, sentence_id, position) VALUES (?, ?, ?, -1)').bind(id, paragraphId, input.sentence_id),
      ...orderStatements(env, 'paragraph_sentences', 'paragraph_id', paragraphId, insertAt(ids, id, position)),
    ]);
    const paragraph = await getParagraph(env, paragraphId);
    const detail = paragraph ? await getParagraphDetail(env, paragraph) : null;
    return successResponse(201, 'CREATED', detail?.sentences.find(sentence => sentence.id === id), origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'sentence_id không tồn tại', origin);
    if (isUniqueConstraint(error)) return errorResponse(409, 'CONFLICT', 'position câu đã tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateParagraphSentence(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readParagraphSentenceInput(request, origin, true);
  if (isResponse(input) || input.position === undefined) return isResponse(input) ? input : errorResponse(400, 'VALIDATION_ERROR', 'Thiếu position', origin);
  try {
    const mapping = await env.DB.prepare('SELECT id, paragraph_id FROM paragraph_sentences WHERE id = ?').bind(id).first<{ id: string; paragraph_id: string }>();
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await paragraphSentenceIds(env, mapping.paragraph_id)).filter(mappingId => mappingId !== id);
    if (input.position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số câu hiện có', origin);
    await env.DB.batch([
      env.DB.prepare('UPDATE paragraph_sentences SET sentence_id = ?, position = -1 WHERE id = ?').bind(input.sentence_id, id),
      ...orderStatements(env, 'paragraph_sentences', 'paragraph_id', mapping.paragraph_id, insertAt(ids, id, input.position!)),
    ]);
    const paragraph = await getParagraph(env, mapping.paragraph_id);
    const detail = paragraph ? await getParagraphDetail(env, paragraph) : null;
    return successResponse(200, 'UPDATED', detail?.sentences.find(sentence => sentence.id === id), origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'sentence_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteParagraphSentence(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const mapping = await env.DB.prepare('SELECT id, paragraph_id FROM paragraph_sentences WHERE id = ?').bind(id).first<{ id: string; paragraph_id: string }>();
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await paragraphSentenceIds(env, mapping.paragraph_id)).filter(mappingId => mappingId !== id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM paragraph_sentences WHERE id = ?').bind(id),
      ...orderStatements(env, 'paragraph_sentences', 'paragraph_id', mapping.paragraph_id, ids),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
