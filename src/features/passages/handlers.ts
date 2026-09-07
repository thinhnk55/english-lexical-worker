import { successResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { generateUUIDv7 } from '../../utils/uuid';
import { parseOptionalMediaUrl } from '../../utils/media';
import { deleteOrphanLexicalStatements, invalidateRuntimeStatements } from '../authoring/context';
import { deleteAssetKeys, entityAssetKeys, orphanLexicalIdsAfterSentenceDeletion } from '../media/assets';

interface PassageRow {
  id: string;
  title_sentence_id: string;
  image: string | null;
  summary: string | null;
  difficulty: number | null;
  reward_points: number;
  visual_bible: string | null;
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
  pronunciations: string | null;
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
  position: number;
  token_indexes: string;
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
  image: string | null;
  summary: string | null;
  difficulty: number | null;
  reward_points: number;
  visual_bible: string | null;
}

interface PassageTermRow {
  id: string;
  code: string;
  name: string;
  description: string;
  translations: string;
  position: number;
  taxonomy_id: string;
  taxonomy_code: string;
  taxonomy_name: string;
  taxonomy_description: string | null;
  taxonomy_translations: string;
  taxonomy_selection_mode: string;
}

interface PassageActivityRow {
  id: string;
  code: string;
  name: string;
  position: number;
  config: string;
  is_enabled: number;
}

interface PositionInput {
  position?: number;
  image?: string | null;
}

interface ParagraphSentenceInput {
  position: number;
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
    pronunciations: parseJson<unknown[]>(row.pronunciations, []),
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
  const summary = body.summary === undefined || body.summary === null
    ? null
    : typeof body.summary === 'string'
      ? body.summary.trim() || null
      : undefined;
  if (summary === undefined) return errorResponse(400, 'VALIDATION_ERROR', 'summary phải là chuỗi hoặc null', origin);
  const difficulty = body.difficulty === undefined || body.difficulty === null ? null : body.difficulty;
  if (difficulty !== null && (!Number.isInteger(difficulty) || !Number.isSafeInteger(difficulty))) {
    return errorResponse(400, 'VALIDATION_ERROR', 'difficulty phải là số nguyên an toàn hoặc null', origin);
  }
  const rewardPoints = body.reward_points === undefined ? 0 : body.reward_points;
  if (!Number.isSafeInteger(rewardPoints) || (rewardPoints as number) < 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'reward_points phải là số nguyên không âm', origin);
  }
  const visualBible = body.visual_bible === undefined || body.visual_bible === null
    ? null
    : typeof body.visual_bible === 'string' ? body.visual_bible.trim() || null : undefined;
  if (visualBible === undefined || (visualBible && visualBible.length > 20_000)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'visual_bible phải là chuỗi tối đa 20000 ký tự hoặc null', origin);
  }
  return {
    title_sentence_id: titleSentenceId,
    image: image ?? null,
    summary,
    difficulty: difficulty as number | null,
    reward_points: rewardPoints as number,
    visual_bible: visualBible,
  };
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

async function readParagraphSentenceInput(request: Request, origin: string): Promise<ParagraphSentenceInput | Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const position = parsePosition(body.position, origin, true);
  if (isResponse(position)) return position;
  return { position: position! };
}

async function getPassage(env: Env, id: string): Promise<PassageRow | null> {
  return env.DB.prepare(`
    SELECT id, title_sentence_id, image, summary, difficulty, reward_points, visual_bible
    FROM passages
    WHERE id = ?
  `).bind(id).first<PassageRow>();
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
  const [rows, lexicalRows] = await Promise.all([
    env.DB.prepare(`
      SELECT
        paragraph_sentences.id AS paragraph_sentence_id,
        paragraph_sentences.position,
        sentences.id,
        sentences.text,
        sentences.tokens,
        sentences.translations,
        sentences.phonemes,
        sentences.pronunciations,
        sentences.audio,
        sentences.image
      FROM paragraph_sentences
      INNER JOIN sentences ON sentences.id = paragraph_sentences.sentence_id
      WHERE paragraph_sentences.paragraph_id = ?
      ORDER BY paragraph_sentences.position ASC
    `).bind(paragraph.id).all<ParagraphSentenceRow>(),
    env.DB.prepare(`
      SELECT
        mapping.id,
        mapping.sentence_id,
        mapping.position,
        mapping.token_indexes,
        lexical.id AS lexical_id,
        lexical.text,
        lexical.type,
        lexical.translations,
        lexical.phonemes,
        lexical.audio,
        lexical.image
      FROM sentence_lexicals mapping
      JOIN paragraph_sentences owner ON owner.sentence_id = mapping.sentence_id
      JOIN lexicals lexical ON lexical.id = mapping.lexical_id
      WHERE owner.paragraph_id = ?
      ORDER BY mapping.sentence_id, mapping.position, mapping.id
    `).bind(paragraph.id).all<SentenceLexicalRuntimeRow>(),
  ]);
  const lexicalsBySentence = new Map<string, Array<{
    id: string;
    position: number;
    token_indexes: number[];
    lexical: ReturnType<typeof parseLexical>;
  }>>();
  for (const lexical of lexicalRows.results) {
    const mappings = lexicalsBySentence.get(lexical.sentence_id) ?? [];
    mappings.push({
      id: lexical.id,
      position: lexical.position,
      token_indexes: parseJson<number[]>(lexical.token_indexes, []),
      lexical: parseLexical(lexical),
    });
    lexicalsBySentence.set(lexical.sentence_id, mappings);
  }
  return {
    id: paragraph.id,
    passage_id: paragraph.passage_id,
    position: paragraph.position,
    image: paragraph.image,
    sentences: rows.results.map(row => ({
      id: row.paragraph_sentence_id,
      position: row.position,
      sentence: { ...parseSentence(row), lexicals: lexicalsBySentence.get(row.id) ?? [] },
    })),
  };
}

async function getPassageDetail(env: Env, passage: PassageRow, includeVisualBible = true) {
  const [titleSentence, paragraphs, bodySentences, lexicalRows, terms, activities] = await Promise.all([
    env.DB.prepare('SELECT id, text, tokens, translations, phonemes, pronunciations, audio, image FROM sentences WHERE id = ?')
      .bind(passage.title_sentence_id)
      .first<SentenceRow>(),
    env.DB.prepare('SELECT id, passage_id, position, image FROM paragraphs WHERE passage_id = ? ORDER BY position ASC')
      .bind(passage.id)
      .all<ParagraphRow>(),
    env.DB.prepare(`
      SELECT
        mapping.id AS paragraph_sentence_id,
        mapping.paragraph_id,
        mapping.position,
        sentence.id,
        sentence.text,
        sentence.tokens,
        sentence.translations,
        sentence.phonemes,
        sentence.pronunciations,
        sentence.audio,
        sentence.image
      FROM paragraph_sentences mapping
      JOIN paragraphs paragraph ON paragraph.id = mapping.paragraph_id
      JOIN sentences sentence ON sentence.id = mapping.sentence_id
      WHERE paragraph.passage_id = ?
      ORDER BY paragraph.position, mapping.position, mapping.id
    `).bind(passage.id).all<ParagraphSentenceRow & { paragraph_id: string }>(),
    env.DB.prepare(`
      SELECT
        mapping.id,
        mapping.sentence_id,
        mapping.position,
        mapping.token_indexes,
        lexical.id AS lexical_id,
        lexical.text,
        lexical.type,
        lexical.translations,
        lexical.phonemes,
        lexical.audio,
        lexical.image
      FROM sentence_lexicals mapping
      JOIN sentence_passages owner ON owner.sentence_id = mapping.sentence_id
      JOIN lexicals lexical ON lexical.id = mapping.lexical_id
      WHERE owner.passage_id = ?
      ORDER BY mapping.sentence_id, mapping.position, mapping.id
    `).bind(passage.id).all<SentenceLexicalRuntimeRow>(),
    env.DB.prepare(`
      SELECT
        term.id,
        term.code,
        term.name,
        term.description,
        term.translations,
        term.position,
        taxonomy.id AS taxonomy_id,
        taxonomy.code AS taxonomy_code,
        taxonomy.name AS taxonomy_name,
        taxonomy.description AS taxonomy_description,
        taxonomy.translations AS taxonomy_translations,
        taxonomy.selection_mode AS taxonomy_selection_mode
      FROM passage_terms assigned
      JOIN taxonomy_terms term ON term.id = assigned.term_id
      JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
      WHERE assigned.passage_id = ?
      ORDER BY taxonomy.name ASC, term.position ASC, term.id ASC
    `).bind(passage.id).all<PassageTermRow>(),
    env.DB.prepare(`
      SELECT id, code, name, position, config, is_enabled
      FROM passage_activities
      WHERE passage_id = ?
      ORDER BY position ASC, id ASC
    `).bind(passage.id).all<PassageActivityRow>(),
  ]);
  if (!titleSentence) throw new Error('Passage title sentence not found');
  const lexicalsBySentence = new Map<string, Array<{
    id: string;
    position: number;
    token_indexes: number[];
    lexical: ReturnType<typeof parseLexical>;
  }>>();
  for (const row of lexicalRows.results) {
    const mappings = lexicalsBySentence.get(row.sentence_id) ?? [];
    mappings.push({
      id: row.id,
      position: row.position,
      token_indexes: parseJson<number[]>(row.token_indexes, []),
      lexical: parseLexical(row),
    });
    lexicalsBySentence.set(row.sentence_id, mappings);
  }
  const sentenceDetail = (sentence: SentenceRow) => ({
    ...parseSentence(sentence),
    lexicals: lexicalsBySentence.get(sentence.id) ?? [],
  });
  const bodyByParagraph = new Map<string, Array<{
    id: string;
    position: number;
    sentence: ReturnType<typeof sentenceDetail>;
  }>>();
  for (const row of bodySentences.results) {
    const values = bodyByParagraph.get(row.paragraph_id) ?? [];
    values.push({ id: row.paragraph_sentence_id, position: row.position, sentence: sentenceDetail(row) });
    bodyByParagraph.set(row.paragraph_id, values);
  }
  return {
    id: passage.id,
    image: passage.image,
    summary: passage.summary,
    difficulty: passage.difficulty,
    reward_points: passage.reward_points,
    ...(includeVisualBible ? { visual_bible: passage.visual_bible } : {}),
    title: sentenceDetail(titleSentence),
    terms: terms.results.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      translations: parseJson<unknown>(row.translations, {}),
      position: row.position,
      taxonomy: {
        id: row.taxonomy_id,
        code: row.taxonomy_code,
        name: row.taxonomy_name,
        description: row.taxonomy_description,
        translations: parseJson<unknown>(row.taxonomy_translations, {}),
        selection_mode: row.taxonomy_selection_mode,
      },
    })),
    activities: activities.results.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      position: row.position,
      config: parseJson<unknown>(row.config, {}),
      is_enabled: row.is_enabled === 1,
    })),
    paragraphs: paragraphs.results.map(paragraph => ({
      id: paragraph.id,
      passage_id: paragraph.passage_id,
      position: paragraph.position,
      image: paragraph.image,
      sentences: bodyByParagraph.get(paragraph.id) ?? [],
    })),
  };
}

// Used only for an authenticated learner's history when an administrator has
// removed the public runtime snapshot. Normal library reads always use
// passages_runtime and avoid authoring joins.
export async function buildPassageDetail(env: Env, passageId: string): Promise<unknown | null> {
  const passage = await getPassage(env, passageId);
  return passage ? getPassageDetail(env, passage, false) : null;
}

async function publishPassageRuntime(env: Env, passageId: string) {
  const passage = await getPassage(env, passageId);
  if (!passage) throw new Error('Passage not found while publishing runtime');
  const payload = await getPassageDetail(env, passage, false);
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
    const status = url.searchParams.get('status');
    if (status && status !== 'draft' && status !== 'published') {
      return errorResponse(400, 'VALIDATION_ERROR', 'status phải là draft hoặc published', origin);
    }
    const parseDifficulty = (name: string): number | null | Response => {
      const raw = url.searchParams.get(name);
      if (raw === null || raw.trim() === '') return null;
      const value = Number(raw);
      return Number.isSafeInteger(value)
        ? value
        : errorResponse(400, 'VALIDATION_ERROR', `${name} phải là số nguyên`, origin);
    };
    const difficultyMin = parseDifficulty('difficulty_min');
    if (isResponse(difficultyMin)) return difficultyMin;
    const difficultyMax = parseDifficulty('difficulty_max');
    if (isResponse(difficultyMax)) return difficultyMax;
    if (difficultyMin !== null && difficultyMax !== null && difficultyMin > difficultyMax) {
      return errorResponse(400, 'VALIDATION_ERROR', 'difficulty_min không được lớn hơn difficulty_max', origin);
    }
    const termIds = [...new Set(url.searchParams.getAll('term_id').map(value => value.trim()).filter(Boolean))];
    if (termIds.length > 20) return errorResponse(400, 'VALIDATION_ERROR', 'Chỉ được lọc tối đa 20 term_id', origin);
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (text) {
      conditions.push('(LOWER(sentences.text) LIKE ? OR LOWER(COALESCE(passages.summary, \'\')) LIKE ?)');
      params.push(`%${text}%`, `%${text}%`);
    }
    if (status === 'draft') conditions.push('runtime.passage_id IS NULL');
    if (status === 'published') conditions.push('runtime.passage_id IS NOT NULL');
    if (difficultyMin !== null) {
      conditions.push('passages.difficulty >= ?');
      params.push(difficultyMin);
    }
    if (difficultyMax !== null) {
      conditions.push('passages.difficulty <= ?');
      params.push(difficultyMax);
    }
    if (termIds.length > 0) {
      conditions.push(`passages.id IN (
        SELECT passage_id FROM passage_terms
        WHERE term_id IN (${termIds.map(() => '?').join(', ')})
        GROUP BY passage_id
        HAVING COUNT(DISTINCT term_id) = ?
      )`);
      params.push(...termIds, termIds.length);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM passages
      INNER JOIN sentences ON sentences.id = passages.title_sentence_id
      LEFT JOIN passages_runtime runtime ON runtime.passage_id = passages.id
      ${where}
    `).bind(...params).first<{ total: number }>();
    const rows = await env.DB.prepare(`
      SELECT
        passages.id,
        passages.title_sentence_id,
        passages.image,
        passages.summary,
        passages.difficulty,
        passages.reward_points,
        sentences.text AS title_text,
        CASE WHEN runtime.passage_id IS NULL THEN 0 ELSE 1 END AS is_published
      FROM passages
      INNER JOIN sentences ON sentences.id = passages.title_sentence_id
      LEFT JOIN passages_runtime runtime ON runtime.passage_id = passages.id
      ${where}
      ORDER BY sentences.text ASC, passages.id ASC
      LIMIT ? OFFSET ?
    `)
      .bind(...params, size, offset)
      .all<PassageRow & { title_text: string; is_published: number }>();
    return successResponse(200, 'SUCCESS', rows.results.map(row => ({
      id: row.id,
      title_sentence_id: row.title_sentence_id,
      title: row.title_text,
      image: row.image,
      summary: row.summary,
      difficulty: row.difficulty,
      reward_points: row.reward_points,
      is_published: row.is_published === 1,
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

export async function handleUpdatePassage(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readPassageInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const existing = await getPassage(env, id);
    if (!existing) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    if (input.title_sentence_id !== existing.title_sentence_id) {
      return errorResponse(409, 'CONFLICT', 'Không thể đổi title_sentence_id; hãy edit title sentence hiện tại', origin);
    }
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE passages
        SET title_sentence_id = ?, image = ?, summary = ?, difficulty = ?, reward_points = ?, visual_bible = ?
        WHERE id = ?
      `).bind(
        input.title_sentence_id,
        input.image,
        input.summary,
        input.difficulty,
        input.reward_points,
        input.visual_bible,
        id,
      ),
      ...invalidateRuntimeStatements(env, [id]),
    ]);
    const passage = await getPassage(env, id);
    return successResponse(200, 'UPDATED', passage ? await getPassageDetail(env, passage) : undefined, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) return errorResponse(409, 'CONFLICT', 'title_sentence_id không tồn tại', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeletePassage(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const passage = await getPassage(env, id);
    if (!passage) return errorResponse(404, 'NOT_FOUND', undefined, origin);

    const usage = await env.DB.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM roadmap_passages WHERE passage_id = ?) AS in_roadmap,
        EXISTS(SELECT 1 FROM learner_passages WHERE passage_id = ?) AS in_history
    `).bind(id, id).first<{ in_roadmap: number; in_history: number }>();
    if (usage?.in_roadmap || usage?.in_history) {
      return errorResponse(409, 'CONFLICT', 'Passage đã được dùng trong roadmap hoặc lịch sử học nên không thể xóa', origin);
    }
    const sentenceRows = await env.DB.prepare(`
      SELECT sentence_id FROM sentence_passages WHERE passage_id = ?
    `).bind(id).all<{ sentence_id: string }>();
    const paragraphRows = await env.DB.prepare('SELECT id FROM paragraphs WHERE passage_id = ?')
      .bind(id).all<{ id: string }>();
    const lexicalRows = await env.DB.prepare(`
      SELECT lexical_id FROM passage_lexicals WHERE passage_id = ?
    `).bind(id).all<{ lexical_id: string }>();
    const sentenceIds = sentenceRows.results.map(row => row.sentence_id);
    const lexicalIds = lexicalRows.results.map(row => row.lexical_id);
    const orphanLexicalIds = await orphanLexicalIdsAfterSentenceDeletion(env, lexicalIds, sentenceIds);
    await deleteAssetKeys(env, [
      ...entityAssetKeys('passages', id),
      ...paragraphRows.results.flatMap(row => entityAssetKeys('paragraphs', row.id)),
      ...sentenceIds.flatMap(sentenceId => entityAssetKeys('sentences', sentenceId)),
      ...orphanLexicalIds.flatMap(lexicalId => entityAssetKeys('lexicals', lexicalId)),
    ]);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM passages WHERE id = ?').bind(id),
      ...sentenceIds.map(sentenceId => env.DB.prepare('DELETE FROM sentences WHERE id = ?').bind(sentenceId)),
      ...deleteOrphanLexicalStatements(env, lexicalIds),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    if (isForeignKeyConstraint(error)) {
      return errorResponse(409, 'CONFLICT', 'Passage đã được dùng trong roadmap hoặc lịch sử học nên không thể xóa', origin);
    }
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
      ...invalidateRuntimeStatements(env, [passageId]),
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
    statements.push(...invalidateRuntimeStatements(env, [paragraph.passage_id]));
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
    const sentenceRows = await env.DB.prepare(`
      SELECT sentence_id FROM paragraph_sentences WHERE paragraph_id = ?
    `).bind(id).all<{ sentence_id: string }>();
    const lexicalRows = await env.DB.prepare(`
      SELECT DISTINCT mapping.lexical_id
      FROM sentence_lexicals mapping
      JOIN paragraph_sentences owner ON owner.sentence_id = mapping.sentence_id
      WHERE owner.paragraph_id = ?
    `).bind(id).all<{ lexical_id: string }>();
    const sentenceIds = sentenceRows.results.map(row => row.sentence_id);
    const lexicalIds = lexicalRows.results.map(row => row.lexical_id);
    const orphanLexicalIds = await orphanLexicalIdsAfterSentenceDeletion(env, lexicalIds, sentenceIds);
    await deleteAssetKeys(env, [
      ...entityAssetKeys('paragraphs', id),
      ...sentenceIds.flatMap(sentenceId => entityAssetKeys('sentences', sentenceId)),
      ...orphanLexicalIds.flatMap(lexicalId => entityAssetKeys('lexicals', lexicalId)),
    ]);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM paragraphs WHERE id = ?').bind(id),
      ...orderStatements(env, 'paragraphs', 'passage_id', paragraph.passage_id, ids),
      ...sentenceIds.map(sentenceId => env.DB.prepare('DELETE FROM sentences WHERE id = ?').bind(sentenceId)),
      ...deleteOrphanLexicalStatements(env, lexicalIds),
      ...invalidateRuntimeStatements(env, [paragraph.passage_id]),
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

export async function handleUpdateParagraphSentence(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readParagraphSentenceInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const mapping = await env.DB.prepare(`
      SELECT mapping.id, mapping.paragraph_id, mapping.sentence_id, paragraph.passage_id
      FROM paragraph_sentences mapping
      JOIN paragraphs paragraph ON paragraph.id = mapping.paragraph_id
      WHERE mapping.id = ?
    `).bind(id).first<{ id: string; paragraph_id: string; sentence_id: string; passage_id: string }>();
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await paragraphSentenceIds(env, mapping.paragraph_id)).filter(mappingId => mappingId !== id);
    if (input.position > ids.length) return errorResponse(400, 'VALIDATION_ERROR', 'position vượt quá số câu hiện có', origin);
    await env.DB.batch([
      env.DB.prepare('UPDATE paragraph_sentences SET position = -1 WHERE id = ?').bind(id),
      ...orderStatements(env, 'paragraph_sentences', 'paragraph_id', mapping.paragraph_id, insertAt(ids, id, input.position!)),
      ...invalidateRuntimeStatements(env, [mapping.passage_id]),
    ]);
    const paragraph = await getParagraph(env, mapping.paragraph_id);
    const detail = paragraph ? await getParagraphDetail(env, paragraph) : null;
    return successResponse(200, 'UPDATED', detail?.sentences.find(sentence => sentence.id === id), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteParagraphSentence(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const mapping = await env.DB.prepare(`
      SELECT mapping.id, mapping.paragraph_id, mapping.sentence_id, paragraph.passage_id
      FROM paragraph_sentences mapping
      JOIN paragraphs paragraph ON paragraph.id = mapping.paragraph_id
      WHERE mapping.id = ?
    `).bind(id).first<{ id: string; paragraph_id: string; sentence_id: string; passage_id: string }>();
    if (!mapping) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const ids = (await paragraphSentenceIds(env, mapping.paragraph_id)).filter(mappingId => mappingId !== id);
    const lexicalRows = await env.DB.prepare(`
      SELECT DISTINCT lexical_id FROM sentence_lexicals WHERE sentence_id = ?
    `).bind(mapping.sentence_id).all<{ lexical_id: string }>();
    const lexicalIds = lexicalRows.results.map(row => row.lexical_id);
    const orphanLexicalIds = await orphanLexicalIdsAfterSentenceDeletion(env, lexicalIds, [mapping.sentence_id]);
    await deleteAssetKeys(env, [
      ...entityAssetKeys('sentences', mapping.sentence_id),
      ...orphanLexicalIds.flatMap(lexicalId => entityAssetKeys('lexicals', lexicalId)),
    ]);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM paragraph_sentences WHERE id = ?').bind(id),
      ...orderStatements(env, 'paragraph_sentences', 'paragraph_id', mapping.paragraph_id, ids),
      env.DB.prepare('DELETE FROM sentences WHERE id = ?').bind(mapping.sentence_id),
      ...deleteOrphanLexicalStatements(env, lexicalIds),
      ...invalidateRuntimeStatements(env, [mapping.passage_id]),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
