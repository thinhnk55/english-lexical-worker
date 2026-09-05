import { parseOptionalMediaUrl } from '../../utils/media';
import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';
import { isLexicalType, type LexicalType } from '../lexicals/constants';

const MAX_JSON_BYTES = 1_500_000;
const MAX_PARAGRAPHS = 50;
const MAX_SENTENCES = 300;
const MAX_LEXICAL_REFERENCES = 2_000;
const MAX_BATCH_STATEMENTS = 1_000;
const POSITION_OFFSET = 1_000_000;

type JsonObject = Record<string, unknown>;

interface ImportLexical {
  id: string;
  text: string;
  type: LexicalType;
  translations: Record<string, string>;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
}

interface ImportSentence {
  id: string;
  text: string;
  tokens: string[];
  translations: Record<string, string> | null;
  phonemes: string | null;
  audio: string | null;
  image: string | null;
  lexicals: Array<ImportLexical & { position: number; token_indexes: string | null }>;
}

interface ImportParagraph {
  id: string;
  position: number;
  image: string | null;
  sentences: ImportSentence[];
}

interface ImportTermRef {
  term_id?: string;
  taxonomy_code?: string;
  code?: string;
}

interface ImportActivity {
  id: string;
  code: string;
  name: string;
  position: number;
  config: unknown;
  is_enabled: boolean;
}

interface ImportPassage {
  id: string;
  title: ImportSentence;
  image: string | null;
  summary: string | null;
  difficulty: number | null;
  reward_points: number;
  terms: ImportTermRef[];
  activities: ImportActivity[];
  paragraphs: ImportParagraph[];
  replace_paragraphs: boolean;
  replace_activities: boolean;
}

interface NormalizedImport {
  passage: ImportPassage;
  warnings: string[];
}

interface ExistingLookup {
  passageExists: boolean;
  sentenceIds: Set<string>;
  lexicalIds: Set<string>;
  lexicalByKey: Map<string, string>;
  termIds: Set<string>;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint|unique|foreign key/i.test(error.message);
}

function objectValue(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function translations(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const result: Record<string, string> = {};
  for (const [locale, translation] of Object.entries(value)) {
    if (typeof translation !== 'string') return null;
    result[locale] = translation.trim();
  }
  return result;
}

function normalizedKey(value: string, type: string): string {
  return `${value.trim().toLocaleLowerCase()}::${type.trim().toLocaleLowerCase()}`;
}

function readMedia(value: unknown, field: 'audio' | 'image', origin: string): string | null | Response {
  const media = parseOptionalMediaUrl(value, field, origin);
  if (isResponse(media)) return media;
  return media ?? null;
}

function readLexical(raw: unknown, origin: string): ImportLexical | Response {
  const value = objectValue(raw);
  if (!value) return errorResponse(400, 'VALIDATION_ERROR', 'lexical phải là object', origin);
  const lexicalText = text(value.text);
  const type = text(value.type)?.toLowerCase() ?? '';
  if (!lexicalText || !type || !isLexicalType(type)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'lexical cần text và type hợp lệ', origin);
  }
  const lexicalTranslations = translations(value.translations);
  if (lexicalTranslations === null) return errorResponse(400, 'VALIDATION_ERROR', 'lexical.translations không hợp lệ', origin);
  const phonemes = value.phonemes === undefined || value.phonemes === null
    ? null
    : typeof value.phonemes === 'string' ? value.phonemes.trim() || null : undefined;
  if (phonemes === undefined) return errorResponse(400, 'VALIDATION_ERROR', 'lexical.phonemes phải là chuỗi hoặc null', origin);
  const audio = readMedia(value.audio, 'audio', origin);
  if (isResponse(audio)) return audio;
  const image = readMedia(value.image, 'image', origin);
  if (isResponse(image)) return image;
  return {
    id: text(value.id) ?? generateUUIDv7(),
    text: lexicalText,
    type,
    translations: lexicalTranslations,
    phonemes,
    audio,
    image,
  };
}

function readSentence(raw: unknown, origin: string, warnings: string[], lexicalLimit: { value: number }): ImportSentence | Response {
  const value = objectValue(raw);
  if (!value) return errorResponse(400, 'VALIDATION_ERROR', 'sentence phải là object', origin);
  const sentenceText = text(value.text);
  if (!sentenceText) return errorResponse(400, 'VALIDATION_ERROR', 'sentence.text không được để trống', origin);
  const rawTokens = value.tokens;
  let tokens: string[];
  if (rawTokens === undefined || rawTokens === null) {
    tokens = sentenceText.split(/\s+/).filter(Boolean);
    warnings.push(`Sentence "${sentenceText.slice(0, 40)}" thiếu tokens; backend đã tách theo khoảng trắng.`);
  } else if (Array.isArray(rawTokens) && rawTokens.length > 0 && rawTokens.every(token => typeof token === 'string' && token.trim())) {
    tokens = rawTokens.map(token => token.trim());
  } else {
    return errorResponse(400, 'VALIDATION_ERROR', 'sentence.tokens phải là mảng chuỗi hoặc bỏ trống để tự sinh', origin);
  }
  const sentenceTranslations = translations(value.translations);
  if (sentenceTranslations === null) return errorResponse(400, 'VALIDATION_ERROR', 'sentence.translations không hợp lệ', origin);
  const phonemes = value.phonemes === undefined || value.phonemes === null
    ? null
    : typeof value.phonemes === 'string' ? value.phonemes.trim() || null : undefined;
  if (phonemes === undefined) return errorResponse(400, 'VALIDATION_ERROR', 'sentence.phonemes phải là chuỗi hoặc null', origin);
  const audio = readMedia(value.audio, 'audio', origin);
  if (isResponse(audio)) return audio;
  const image = readMedia(value.image, 'image', origin);
  if (isResponse(image)) return image;
  const rawLexicals = value.lexicals === undefined ? [] : value.lexicals;
  if (!Array.isArray(rawLexicals)) return errorResponse(400, 'VALIDATION_ERROR', 'sentence.lexicals phải là mảng', origin);
  const lexicals: ImportSentence['lexicals'] = [];
  for (let index = 0; index < rawLexicals.length; index += 1) {
    lexicalLimit.value += 1;
    if (lexicalLimit.value > MAX_LEXICAL_REFERENCES) return errorResponse(400, 'VALIDATION_ERROR', `Một passage chỉ được tối đa ${MAX_LEXICAL_REFERENCES} lexical reference`, origin);
    const rawLexical = objectValue(rawLexicals[index]);
    const lexical = readLexical(rawLexicals[index], origin);
    if (isResponse(lexical)) return lexical;
    const position = rawLexical?.position === undefined ? index : rawLexical.position;
    if (!Number.isSafeInteger(position) || (position as number) < 0) return errorResponse(400, 'VALIDATION_ERROR', 'lexical.position phải là số nguyên không âm', origin);
    const tokenIndexes = rawLexical?.token_indexes;
    if (tokenIndexes !== undefined && tokenIndexes !== null && typeof tokenIndexes !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'lexical.token_indexes phải là chuỗi hoặc null', origin);
    }
    lexicals.push({ ...lexical, position: position as number, token_indexes: tokenIndexes === undefined ? null : tokenIndexes as string | null });
  }
  return {
    id: text(value.id) ?? generateUUIDv7(),
    text: sentenceText,
    tokens,
    translations: sentenceTranslations,
    phonemes,
    audio,
    image,
    lexicals,
  };
}

function readTermRefs(raw: unknown, origin: string): ImportTermRef[] | Response {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 50) return errorResponse(400, 'VALIDATION_ERROR', 'terms phải là mảng tối đa 50 phần tử', origin);
  const refs: ImportTermRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = objectValue(item);
    if (!value) return errorResponse(400, 'VALIDATION_ERROR', 'Mỗi term ref phải là object', origin);
    const termId = text(value.term_id);
    const taxonomyCode = text(value.taxonomy_code);
    const code = text(value.code);
    if (!termId && !(taxonomyCode && code)) return errorResponse(400, 'VALIDATION_ERROR', 'Term cần term_id hoặc taxonomy_code + code', origin);
    const key = termId ?? `${taxonomyCode}::${code}`;
    if (seen.has(key)) return errorResponse(400, 'VALIDATION_ERROR', `Term ${key} bị lặp`, origin);
    seen.add(key);
    refs.push({ ...(termId ? { term_id: termId } : {}), ...(taxonomyCode ? { taxonomy_code: taxonomyCode } : {}), ...(code ? { code } : {}) });
  }
  return refs;
}

function readActivities(raw: unknown, origin: string): ImportActivity[] | Response {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 50) return errorResponse(400, 'VALIDATION_ERROR', 'activities phải là mảng tối đa 50 phần tử', origin);
  const activities: ImportActivity[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = objectValue(raw[index]);
    if (!value) return errorResponse(400, 'VALIDATION_ERROR', 'Mỗi activity phải là object', origin);
    const code = text(value.code);
    const name = text(value.name);
    const position = value.position === undefined ? index : value.position;
    if (!code || !/^[a-z0-9][a-z0-9_-]*$/.test(code) || !name) return errorResponse(400, 'VALIDATION_ERROR', 'Activity cần code và name hợp lệ', origin);
    if (!Number.isSafeInteger(position) || (position as number) < 0) return errorResponse(400, 'VALIDATION_ERROR', 'activity.position phải là số nguyên không âm', origin);
    const isEnabled = value.is_enabled === undefined ? true : value.is_enabled;
    if (typeof isEnabled !== 'boolean') return errorResponse(400, 'VALIDATION_ERROR', 'activity.is_enabled phải là boolean', origin);
    const config = value.config === undefined ? {} : value.config;
    try { JSON.stringify(config); } catch { return errorResponse(400, 'VALIDATION_ERROR', 'activity.config không hợp lệ', origin); }
    activities.push({ id: text(value.id) ?? generateUUIDv7(), code, name, position: position as number, config, is_enabled: isEnabled });
  }
  return activities;
}

async function readImport(request: Request, origin: string): Promise<NormalizedImport | Response> {
  let rawBody: unknown;
  try { rawBody = await request.json(); } catch { return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin); }
  const body = objectValue(rawBody);
  if (!body) return errorResponse(400, 'VALIDATION_ERROR', 'Payload import phải là JSON object', origin);
  if (JSON.stringify(rawBody).length > MAX_JSON_BYTES) return errorResponse(413, 'VALIDATION_ERROR', 'Payload import vượt quá 1.5 MB', origin);
  const rawPassage = objectValue(body.passage);
  if (!rawPassage) return errorResponse(400, 'VALIDATION_ERROR', 'Payload cần passage object', origin);
  const warnings: string[] = [];
  const lexicalLimit = { value: 0 };
  const rawTitle = rawPassage.title ?? rawPassage.title_sentence;
  const title = readSentence(rawTitle, origin, warnings, lexicalLimit);
  if (isResponse(title)) return title;
  const rawParagraphs = rawPassage.paragraphs;
  if (!Array.isArray(rawParagraphs) || rawParagraphs.length > MAX_PARAGRAPHS) return errorResponse(400, 'VALIDATION_ERROR', `paragraphs phải là mảng tối đa ${MAX_PARAGRAPHS} phần tử`, origin);
  const paragraphs: ImportParagraph[] = [];
  let sentenceCount = 0;
  for (let paragraphIndex = 0; paragraphIndex < rawParagraphs.length; paragraphIndex += 1) {
    const value = objectValue(rawParagraphs[paragraphIndex]);
    if (!value) return errorResponse(400, 'VALIDATION_ERROR', `paragraph thứ ${paragraphIndex + 1} không hợp lệ`, origin);
    const rawSentences = value.sentences;
    if (!Array.isArray(rawSentences)) return errorResponse(400, 'VALIDATION_ERROR', `paragraph thứ ${paragraphIndex + 1} thiếu sentences`, origin);
    sentenceCount += rawSentences.length;
    if (sentenceCount > MAX_SENTENCES) return errorResponse(400, 'VALIDATION_ERROR', `Một passage chỉ được tối đa ${MAX_SENTENCES} sentences`, origin);
    const sentences: ImportSentence[] = [];
    for (const rawSentence of rawSentences) {
      const sentence = readSentence(rawSentence, origin, warnings, lexicalLimit);
      if (isResponse(sentence)) return sentence;
      sentences.push(sentence);
    }
    const image = readMedia(value.image, 'image', origin);
    if (isResponse(image)) return image;
    const position = value.position === undefined ? paragraphIndex : value.position;
    if (!Number.isSafeInteger(position) || (position as number) < 0) return errorResponse(400, 'VALIDATION_ERROR', 'paragraph.position phải là số nguyên không âm', origin);
    paragraphs.push({ id: text(value.id) ?? generateUUIDv7(), position: position as number, image, sentences });
  }
  const image = readMedia(rawPassage.image, 'image', origin);
  if (isResponse(image)) return image;
  const summary = rawPassage.summary === undefined || rawPassage.summary === null ? null : text(rawPassage.summary);
  if (rawPassage.summary !== undefined && rawPassage.summary !== null && summary === null) return errorResponse(400, 'VALIDATION_ERROR', 'passage.summary phải là chuỗi hoặc null', origin);
  const difficulty = rawPassage.difficulty === undefined || rawPassage.difficulty === null ? null : rawPassage.difficulty;
  if (difficulty !== null && (!Number.isSafeInteger(difficulty) || !Number.isInteger(difficulty))) return errorResponse(400, 'VALIDATION_ERROR', 'passage.difficulty phải là số nguyên hoặc null', origin);
  const rewardPoints = rawPassage.reward_points === undefined ? 0 : rawPassage.reward_points;
  if (!Number.isSafeInteger(rewardPoints) || (rewardPoints as number) < 0) return errorResponse(400, 'VALIDATION_ERROR', 'passage.reward_points phải là số nguyên không âm', origin);
  const terms = readTermRefs(rawPassage.terms, origin);
  if (isResponse(terms)) return terms;
  const activities = readActivities(rawPassage.activities, origin);
  if (isResponse(activities)) return activities;
  const replaceParagraphs = rawPassage.replace_paragraphs === true;
  const replaceActivities = rawPassage.replace_activities === true;
  const sentenceIds = [title.id, ...paragraphs.flatMap(paragraph => paragraph.sentences.map(sentence => sentence.id))];
  if (new Set(sentenceIds).size !== sentenceIds.length) return errorResponse(400, 'VALIDATION_ERROR', 'Các sentence id trong payload bị trùng', origin);
  const paragraphIds = paragraphs.map(paragraph => paragraph.id);
  if (new Set(paragraphIds).size !== paragraphIds.length) return errorResponse(400, 'VALIDATION_ERROR', 'Các paragraph id trong payload bị trùng', origin);
  if (new Set(paragraphs.map(paragraph => paragraph.position)).size !== paragraphs.length) return errorResponse(400, 'VALIDATION_ERROR', 'Các paragraph position trong payload bị trùng', origin);
  const activityIds = activities.map(activity => activity.id);
  if (new Set(activityIds).size !== activityIds.length) return errorResponse(400, 'VALIDATION_ERROR', 'Các activity id trong payload bị trùng', origin);
  if (new Set(activities.map(activity => activity.position)).size !== activities.length) return errorResponse(400, 'VALIDATION_ERROR', 'Các activity position trong payload bị trùng', origin);
  return {
    passage: {
      id: text(rawPassage.id) ?? generateUUIDv7(),
      title,
      image,
      summary,
      difficulty: difficulty as number | null,
      reward_points: rewardPoints as number,
      terms,
      activities,
      paragraphs,
      replace_paragraphs: replaceParagraphs,
      replace_activities: replaceActivities,
    },
    warnings,
  };
}

function allSentences(imported: ImportPassage): ImportSentence[] {
  return [imported.title, ...imported.paragraphs.flatMap(paragraph => paragraph.sentences)];
}

function canonicalizeLexicals(imported: ImportPassage): void {
  const canonicalByKey = new Map<string, string>();
  for (const sentence of allSentences(imported)) {
    for (const lexical of sentence.lexicals) {
      const key = normalizedKey(lexical.text, lexical.type);
      const canonicalId = canonicalByKey.get(key);
      if (canonicalId) lexical.id = canonicalId;
      else canonicalByKey.set(key, lexical.id);
    }
  }
}

function allLexicals(imported: ImportPassage): ImportLexical[] {
  const byKey = new Map<string, ImportLexical>();
  for (const sentence of allSentences(imported)) {
    for (const lexical of sentence.lexicals) {
      const key = normalizedKey(lexical.text, lexical.type);
      if (!byKey.has(key)) byKey.set(key, lexical);
    }
  }
  return [...byKey.values()];
}

async function lookupExisting(env: Env, imported: ImportPassage): Promise<ExistingLookup> {
  const sentenceIds = allSentences(imported).map(sentence => sentence.id);
  const lexicalList = allLexicals(imported);
  const termIds = imported.terms.flatMap(term => term.term_id ? [term.term_id] : []);
  const sentenceRows: Array<{ id: string }> = [];
  for (const ids of chunks(sentenceIds, 90)) {
    if (ids.length === 0) continue;
    const rows = await env.DB.prepare(`SELECT id FROM sentences WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all<{ id: string }>();
    sentenceRows.push(...rows.results);
  }
  const lexicalIds = lexicalList.map(lexical => lexical.id);
  const lexicalRows: Array<{ id: string }> = [];
  for (const ids of chunks(lexicalIds, 90)) {
    if (ids.length === 0) continue;
    const rows = await env.DB.prepare(`SELECT id FROM lexicals WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all<{ id: string }>();
    lexicalRows.push(...rows.results);
  }
  const lexicalByKey = new Map<string, string>();
  for (const lexicalChunk of chunks(lexicalList, 40)) {
    if (lexicalChunk.length === 0) continue;
    const clauses = lexicalChunk.map(() => '(LOWER(TRIM(text)) = ? AND type = ?)').join(' OR ');
    const params = lexicalChunk.flatMap(lexical => [lexical.text.toLocaleLowerCase(), lexical.type]);
    const rows = await env.DB.prepare(`SELECT id, text, type FROM lexicals WHERE ${clauses}`).bind(...params).all<{ id: string; text: string; type: string }>();
    for (const row of rows.results) lexicalByKey.set(normalizedKey(row.text, row.type), row.id);
  }
  const termRows = termIds.length === 0 ? [] : (await env.DB.prepare(`SELECT id FROM taxonomy_terms WHERE id IN (${termIds.map(() => '?').join(', ')})`).bind(...termIds).all<{ id: string }>()).results;
  const passage = await env.DB.prepare('SELECT id FROM passages WHERE id = ?').bind(imported.id).first<{ id: string }>();
  return {
    passageExists: Boolean(passage),
    sentenceIds: new Set(sentenceRows.map(row => row.id)),
    lexicalIds: new Set(lexicalRows.map(row => row.id)),
    lexicalByKey,
    termIds: new Set(termRows.map(row => row.id)),
  };
}

function resolveLexicalIds(imported: ImportPassage, lookup: ExistingLookup): void {
  for (const sentence of allSentences(imported)) {
    for (const lexical of sentence.lexicals) {
      const existing = lookup.lexicalByKey.get(normalizedKey(lexical.text, lexical.type));
      if (existing && existing !== lexical.id) lexical.id = existing;
    }
  }
}

function validateReferences(imported: ImportPassage, lookup: ExistingLookup, strategy: 'create' | 'upsert'): string[] {
  const errors: string[] = [];
  if (strategy === 'create' && lookup.passageExists) errors.push(`passage ${imported.id} đã tồn tại; dùng strategy upsert hoặc bỏ id`);
  for (const sentence of allSentences(imported)) {
    if (strategy === 'create' && lookup.sentenceIds.has(sentence.id)) errors.push(`sentence ${sentence.id} đã tồn tại`);
  }
  const lexicalIdKeys = new Map<string, string>();
  for (const lexical of allLexicals(imported)) {
    const key = normalizedKey(lexical.text, lexical.type);
    const previousKey = lexicalIdKeys.get(lexical.id);
    if (previousKey && previousKey !== key) errors.push(`lexical id ${lexical.id} được dùng cho nhiều text/type khác nhau`);
    lexicalIdKeys.set(lexical.id, key);
    if (strategy === 'create' && lookup.lexicalIds.has(lexical.id) && !lookup.lexicalByKey.has(normalizedKey(lexical.text, lexical.type))) errors.push(`lexical ${lexical.id} đã tồn tại`);
  }
  for (const term of imported.terms) {
    if (term.term_id && !lookup.termIds.has(term.term_id)) errors.push(`term ${term.term_id} không tồn tại`);
  }
  return errors;
}

function resolveTermId(ref: ImportTermRef, termIds: Map<string, string>): string | null {
  if (ref.term_id) return ref.term_id;
  return ref.taxonomy_code && ref.code ? termIds.get(`${ref.taxonomy_code}::${ref.code}`) ?? null : null;
}

async function resolveTermCodes(env: Env, imported: ImportPassage): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const refs = imported.terms.filter((ref): ref is ImportTermRef & { taxonomy_code: string; code: string } => Boolean(ref.taxonomy_code && ref.code));
  for (const refChunk of chunks(refs, 40)) {
    if (refChunk.length === 0) continue;
    const clauses = refChunk.map(() => '(taxonomy.code = ? AND term.code = ?)').join(' OR ');
    const params = refChunk.flatMap(ref => [ref.taxonomy_code, ref.code]);
    const rows = await env.DB.prepare(`
      SELECT term.id, taxonomy.code AS taxonomy_code, term.code
      FROM taxonomy_terms term
      JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
      WHERE ${clauses}
    `).bind(...params).all<{ id: string; taxonomy_code: string; code: string }>();
    for (const row of rows.results) map.set(`${row.taxonomy_code}::${row.code}`, row.id);
  }
  return map;
}

function plan(imported: ImportPassage, lookup: ExistingLookup, strategy: 'create' | 'upsert', termCodeIds: Map<string, string>) {
  canonicalizeLexicals(imported);
  resolveLexicalIds(imported, lookup);
  const errors = validateReferences(imported, lookup, strategy);
  for (const term of imported.terms) {
    if (!term.term_id && !resolveTermId(term, termCodeIds)) errors.push(`term ${term.taxonomy_code}::${term.code} không tồn tại`);
  }
  const sentences = allSentences(imported);
  const lexicals = allLexicals(imported);
  const lexicalReferences = imported.paragraphs.reduce((sum, paragraph) => sum + paragraph.sentences.reduce((inner, sentence) => inner + sentence.lexicals.length, 0), imported.title.lexicals.length);
  const estimatedStatements = 1
    + Math.ceil(lexicals.length / 14)
    + Math.ceil(sentences.length / 14)
    + 1
    + Math.ceil(imported.terms.length / 50)
    + 1
    + Math.ceil(imported.paragraphs.length / 25)
    + imported.paragraphs.length
    + Math.ceil(imported.paragraphs.reduce((sum, paragraph) => sum + paragraph.sentences.length, 0) / 25)
    + 1
    + Math.ceil(imported.activities.length / 14)
    + sentences.length
    + Math.ceil(lexicalReferences / 20)
    + 1;
  if (estimatedStatements > MAX_BATCH_STATEMENTS) errors.push(`Import quá lớn: ước tính ${estimatedStatements} statements, tối đa ${MAX_BATCH_STATEMENTS}`);
  return {
    errors,
    counts: {
      passages: 1,
      paragraphs: imported.paragraphs.length,
      sentences: sentences.length,
      lexical_references: lexicalReferences,
      unique_lexicals: lexicals.length,
      terms: imported.terms.length,
      activities: imported.activities.length,
    },
    actions: {
      passage: lookup.passageExists ? 'update' : 'create',
      sentences: sentences.filter(sentence => lookup.sentenceIds.has(sentence.id)).length,
      lexicals: lexicals.filter(lexical => lookup.lexicalIds.has(lexical.id) || lookup.lexicalByKey.has(normalizedKey(lexical.text, lexical.type))).length,
    },
    estimated_statements: estimatedStatements,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

type SqlValue = string | number | null;

function pushBulkInsert(
  env: Env,
  statements: D1PreparedStatement[],
  table: string,
  columns: string,
  rows: SqlValue[][],
  suffix: string,
): void {
  const columnCount = columns.split(',').length;
  for (const rowChunk of chunks(rows, Math.max(1, Math.floor(100 / columnCount)))) {
    const placeholders = rowChunk.map(() => `(${Array.from({ length: columnCount }, () => '?').join(', ')})`).join(', ');
    statements.push(env.DB.prepare(`INSERT INTO ${table} (${columns}) VALUES ${placeholders} ${suffix}`).bind(...rowChunk.flat()));
  }
}

async function importTransaction(env: Env, imported: ImportPassage, termCodeIds: Map<string, string>, strategy: 'create' | 'upsert'): Promise<void> {
  const sentences = allSentences(imported);
  const lexicals = allLexicals(imported);
  const resolvedTerms = imported.terms.map(ref => resolveTermId(ref, termCodeIds)).filter((id): id is string => Boolean(id));
  const statements: D1PreparedStatement[] = [];
  pushBulkInsert(env, statements, 'lexicals', 'id, text, type, translations, phonemes, audio, image', lexicals.map(lexical => [lexical.id, lexical.text, lexical.type, JSON.stringify(lexical.translations), lexical.phonemes, lexical.audio, lexical.image]), strategy === 'upsert'
    ? 'ON CONFLICT(id) DO UPDATE SET text = excluded.text, type = excluded.type, translations = excluded.translations, phonemes = excluded.phonemes, audio = excluded.audio, image = excluded.image'
    : 'ON CONFLICT(id) DO NOTHING');
  pushBulkInsert(env, statements, 'sentences', 'id, text, tokens, translations, phonemes, audio, image', sentences.map(sentence => [sentence.id, sentence.text, JSON.stringify(sentence.tokens), sentence.translations ? JSON.stringify(sentence.translations) : null, sentence.phonemes, sentence.audio, sentence.image]), strategy === 'upsert'
    ? 'ON CONFLICT(id) DO UPDATE SET text = excluded.text, tokens = excluded.tokens, translations = excluded.translations, phonemes = excluded.phonemes, audio = excluded.audio, image = excluded.image'
    : '');
  const passageSql = strategy === 'upsert'
    ? `INSERT INTO passages (id, title_sentence_id, image, summary, difficulty, reward_points)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title_sentence_id = excluded.title_sentence_id, image = excluded.image, summary = excluded.summary, difficulty = excluded.difficulty, reward_points = excluded.reward_points`
    : 'INSERT INTO passages (id, title_sentence_id, image, summary, difficulty, reward_points) VALUES (?, ?, ?, ?, ?, ?)';
  statements.push(env.DB.prepare(passageSql).bind(imported.id, imported.title.id, imported.image, imported.summary, imported.difficulty, imported.reward_points));
  statements.push(env.DB.prepare('DELETE FROM passage_terms WHERE passage_id = ?').bind(imported.id));
  pushBulkInsert(env, statements, 'passage_terms', 'passage_id, term_id', resolvedTerms.map(termId => [imported.id, termId]), '');
  if (imported.replace_paragraphs) statements.push(env.DB.prepare('DELETE FROM paragraphs WHERE passage_id = ?').bind(imported.id));
  else statements.push(env.DB.prepare(`UPDATE paragraphs SET position = position + ${POSITION_OFFSET} WHERE passage_id = ?`).bind(imported.id));
  pushBulkInsert(env, statements, 'paragraphs', 'id, passage_id, position, image', imported.paragraphs.map(paragraph => [paragraph.id, imported.id, paragraph.position, paragraph.image]), 'ON CONFLICT(id) DO UPDATE SET passage_id = excluded.passage_id, position = excluded.position, image = excluded.image');
  for (const paragraph of imported.paragraphs) {
    statements.push(env.DB.prepare('DELETE FROM paragraph_sentences WHERE paragraph_id = ?').bind(paragraph.id));
  }
  pushBulkInsert(env, statements, 'paragraph_sentences', 'id, paragraph_id, sentence_id, position', imported.paragraphs.flatMap(paragraph => paragraph.sentences.map((sentence, position) => [generateUUIDv7(), paragraph.id, sentence.id, position])), '');
  if (!imported.replace_paragraphs) statements.push(env.DB.prepare(`UPDATE paragraphs SET position = position - ${POSITION_OFFSET} WHERE passage_id = ? AND position >= ${POSITION_OFFSET}`).bind(imported.id));
  if (imported.replace_activities) statements.push(env.DB.prepare('DELETE FROM passage_activities WHERE passage_id = ?').bind(imported.id));
  else statements.push(env.DB.prepare(`UPDATE passage_activities SET position = position + ${POSITION_OFFSET} WHERE passage_id = ?`).bind(imported.id));
  pushBulkInsert(env, statements, 'passage_activities', 'id, passage_id, code, name, position, config, is_enabled', imported.activities.map(activity => [activity.id, imported.id, activity.code, activity.name, activity.position, JSON.stringify(activity.config), activity.is_enabled ? 1 : 0]), 'ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, position = excluded.position, config = excluded.config, is_enabled = excluded.is_enabled');
  if (!imported.replace_activities) statements.push(env.DB.prepare(`UPDATE passage_activities SET position = position - ${POSITION_OFFSET} WHERE passage_id = ? AND position >= ${POSITION_OFFSET}`).bind(imported.id));
  for (const sentence of sentences) {
    statements.push(env.DB.prepare('DELETE FROM sentence_lexicals WHERE sentence_id = ?').bind(sentence.id));
  }
  pushBulkInsert(env, statements, 'sentence_lexicals', 'id, sentence_id, lexical_id, position, token_indexes', sentences.flatMap(sentence => sentence.lexicals.map(lexical => [generateUUIDv7(), sentence.id, lexical.id, lexical.position, lexical.token_indexes])), '');
  // Source edits invalidate the snapshot. Admin must explicitly publish again.
  statements.push(env.DB.prepare('DELETE FROM passages_runtime WHERE passage_id = ?').bind(imported.id));
  if (statements.length > MAX_BATCH_STATEMENTS) throw new Error(`Import quá lớn: cần ${statements.length} statements, tối đa ${MAX_BATCH_STATEMENTS}`);
  await env.DB.batch(statements);
}

export async function handlePreviewPassageImport(request: Request, env: Env, origin: string): Promise<Response> {
  const parsed = await readImport(request, origin);
  if (isResponse(parsed)) return parsed;
  try {
    const strategy = new URL(request.url).searchParams.get('strategy') === 'create' ? 'create' : 'upsert';
    const [lookup, termCodeIds] = await Promise.all([lookupExisting(env, parsed.passage), resolveTermCodes(env, parsed.passage)]);
    const result = plan(parsed.passage, lookup, strategy, termCodeIds);
    return successResponse(result.errors.length ? 422 : 200, result.errors.length ? 'VALIDATION_ERROR' : 'SUCCESS', {
      strategy,
      ready: result.errors.length === 0,
      normalized_payload: { passage: parsed.passage },
      warnings: parsed.warnings,
      plan: result,
    }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCommitPassageImport(request: Request, env: Env, origin: string): Promise<Response> {
  const parsed = await readImport(request, origin);
  if (isResponse(parsed)) return parsed;
  try {
    const strategy = new URL(request.url).searchParams.get('strategy') === 'create' ? 'create' : 'upsert';
    const [lookup, termCodeIds] = await Promise.all([lookupExisting(env, parsed.passage), resolveTermCodes(env, parsed.passage)]);
    const result = plan(parsed.passage, lookup, strategy, termCodeIds);
    if (result.errors.length > 0) return errorResponse(422, 'VALIDATION_ERROR', { errors: result.errors, warnings: parsed.warnings, plan: result }, origin);
    await importTransaction(env, parsed.passage, termCodeIds, strategy);
    return successResponse(201, 'CREATED', {
      passage_id: parsed.passage.id,
      strategy,
      runtime_invalidated: true,
      warnings: parsed.warnings,
      plan: result,
    }, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(413, 'VALIDATION_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
