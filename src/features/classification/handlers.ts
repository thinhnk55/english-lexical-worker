import { parsePagination } from '../../utils/pagination';
import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';

type JsonObject = Record<string, unknown>;

interface TaxonomyRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  translations: string;
  selection_mode: 'single' | 'multiple';
}

interface TaxonomyTermRow {
  id: string;
  taxonomy_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  description: string;
  translations: string;
  position: number;
}

interface TaxonomyInput {
  code: string;
  name: string;
  description: string | null;
  translations: Record<string, { name?: string; description?: string }>;
  selection_mode: 'single' | 'multiple';
}

interface TermInput {
  parent_id: string | null;
  code: string;
  name: string;
  description: string;
  translations: Record<string, { name?: string; description?: string }>;
  position: number;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint|unique|foreign key/i.test(error.message);
}

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function parseTaxonomy(row: TaxonomyRow) {
  return { ...row, translations: parseJsonObject(row.translations) };
}

function parseTerm(row: TaxonomyTermRow) {
  return { ...row, translations: parseJsonObject(row.translations) };
}

async function readBody(request: Request, origin: string): Promise<JsonObject | Response> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu phải là một JSON object', origin);
    }
    return body as JsonObject;
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Định dạng JSON không hợp lệ', origin);
  }
}

function readRequiredText(value: unknown, field: string, origin: string): string | Response {
  if (typeof value !== 'string' || !value.trim()) {
    return errorResponse(400, 'VALIDATION_ERROR', `${field} không được để trống`, origin);
  }
  return value.trim();
}

function readCode(value: unknown, origin: string): string | Response {
  const code = readRequiredText(value, 'code', origin);
  if (isResponse(code)) return code;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(code)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'code chỉ gồm chữ thường, số, dấu _ hoặc -', origin);
  }
  return code;
}

function readTranslations(value: unknown, origin: string): Record<string, { name?: string; description?: string }> | Response {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'translations phải là một JSON object', origin);
  }
  const translations: Record<string, { name?: string; description?: string }> = {};
  for (const [locale, rawTranslation] of Object.entries(value)) {
    if (!locale.trim() || typeof rawTranslation !== 'object' || rawTranslation === null || Array.isArray(rawTranslation)) {
      return errorResponse(400, 'VALIDATION_ERROR', `translations.${locale} không hợp lệ`, origin);
    }
    const translation = rawTranslation as JsonObject;
    if (translation.name !== undefined && typeof translation.name !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', `translations.${locale}.name phải là chuỗi`, origin);
    }
    if (translation.description !== undefined && typeof translation.description !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', `translations.${locale}.description phải là chuỗi`, origin);
    }
    translations[locale] = {
      ...(typeof translation.name === 'string' ? { name: translation.name.trim() } : {}),
      ...(typeof translation.description === 'string' ? { description: translation.description.trim() } : {}),
    };
  }
  return translations;
}

async function readTaxonomyInput(request: Request, origin: string): Promise<TaxonomyInput | Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const code = readCode(body.code, origin);
  if (isResponse(code)) return code;
  const name = readRequiredText(body.name, 'name', origin);
  if (isResponse(name)) return name;
  const description = body.description === undefined || body.description === null
    ? null
    : typeof body.description === 'string' ? body.description.trim() || null : undefined;
  if (description === undefined) return errorResponse(400, 'VALIDATION_ERROR', 'description phải là chuỗi hoặc null', origin);
  const translations = readTranslations(body.translations, origin);
  if (isResponse(translations)) return translations;
  if (body.selection_mode !== 'single' && body.selection_mode !== 'multiple') {
    return errorResponse(400, 'VALIDATION_ERROR', 'selection_mode phải là single hoặc multiple', origin);
  }
  return { code, name, description, translations, selection_mode: body.selection_mode };
}

async function readTermInput(request: Request, origin: string): Promise<TermInput | Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  const code = readCode(body.code, origin);
  if (isResponse(code)) return code;
  const name = readRequiredText(body.name, 'name', origin);
  if (isResponse(name)) return name;
  const description = readRequiredText(body.description, 'description', origin);
  if (isResponse(description)) return description;
  const parentId = body.parent_id === undefined || body.parent_id === null
    ? null
    : typeof body.parent_id === 'string' && body.parent_id.trim() ? body.parent_id.trim() : undefined;
  if (parentId === undefined) return errorResponse(400, 'VALIDATION_ERROR', 'parent_id phải là chuỗi hoặc null', origin);
  const position = body.position === undefined ? 0 : body.position;
  if (!Number.isSafeInteger(position) || (position as number) < 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'position phải là số nguyên không âm', origin);
  }
  const translations = readTranslations(body.translations, origin);
  if (isResponse(translations)) return translations;
  return { parent_id: parentId, code, name, description, translations, position: position as number };
}

async function getTaxonomy(env: Env, id: string): Promise<TaxonomyRow | null> {
  return env.DB.prepare(`
    SELECT id, code, name, description, translations, selection_mode
    FROM taxonomies
    WHERE id = ?
  `).bind(id).first<TaxonomyRow>();
}

async function getTerm(env: Env, id: string): Promise<TaxonomyTermRow | null> {
  return env.DB.prepare(`
    SELECT id, taxonomy_id, parent_id, code, name, description, translations, position
    FROM taxonomy_terms
    WHERE id = ?
  `).bind(id).first<TaxonomyTermRow>();
}

async function getPassageTerms(env: Env, passageId: string): Promise<Array<ReturnType<typeof parseTerm> & { taxonomy: ReturnType<typeof parseTaxonomy> }>> {
  const rows = await env.DB.prepare(`
    SELECT
      term.id,
      term.taxonomy_id,
      term.parent_id,
      term.code,
      term.name,
      term.description,
      term.translations,
      term.position,
      taxonomy.code AS taxonomy_code,
      taxonomy.name AS taxonomy_name,
      taxonomy.description AS taxonomy_description,
      taxonomy.translations AS taxonomy_translations,
      taxonomy.selection_mode
    FROM passage_terms assigned
    JOIN taxonomy_terms term ON term.id = assigned.term_id
    JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
    WHERE assigned.passage_id = ?
    ORDER BY taxonomy.name ASC, term.position ASC, term.id ASC
  `).bind(passageId).all<TaxonomyTermRow & {
    taxonomy_code: string;
    taxonomy_name: string;
    taxonomy_description: string | null;
    taxonomy_translations: string;
    selection_mode: 'single' | 'multiple';
  }>();
  return rows.results.map(row => ({
    ...parseTerm(row),
    taxonomy: parseTaxonomy({
      id: row.taxonomy_id,
      code: row.taxonomy_code,
      name: row.taxonomy_name,
      description: row.taxonomy_description,
      translations: row.taxonomy_translations,
      selection_mode: row.selection_mode,
    }),
  }));
}

export async function handleListTaxonomies(request: Request, env: Env, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { page, size, offset } = parsePagination(url);
    const [count, rows] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS total FROM taxonomies').first<{ total: number }>(),
      env.DB.prepare(`
        SELECT id, code, name, description, translations, selection_mode
        FROM taxonomies
        ORDER BY name ASC, id ASC
        LIMIT ? OFFSET ?
      `).bind(size, offset).all<TaxonomyRow>(),
    ]);
    const data = await Promise.all(rows.results.map(async taxonomy => {
      const terms = await env.DB.prepare(`
        SELECT id, taxonomy_id, parent_id, code, name, description, translations, position
        FROM taxonomy_terms
        WHERE taxonomy_id = ?
        ORDER BY position ASC, id ASC
      `).bind(taxonomy.id).all<TaxonomyTermRow>();
      return { ...parseTaxonomy(taxonomy), terms: terms.results.map(parseTerm) };
    }));
    return successResponse(200, 'SUCCESS', data, origin, { page, size, total: count?.total ?? 0 });
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetTaxonomy(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const taxonomy = await getTaxonomy(env, id);
    if (!taxonomy) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const terms = await env.DB.prepare(`
      SELECT id, taxonomy_id, parent_id, code, name, description, translations, position
      FROM taxonomy_terms
      WHERE taxonomy_id = ?
      ORDER BY position ASC, id ASC
    `).bind(id).all<TaxonomyTermRow>();
    return successResponse(200, 'SUCCESS', { ...parseTaxonomy(taxonomy), terms: terms.results.map(parseTerm) }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateTaxonomy(request: Request, env: Env, origin: string): Promise<Response> {
  const input = await readTaxonomyInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    await env.DB.prepare(`
      INSERT INTO taxonomies (id, code, name, description, translations, selection_mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, input.code, input.name, input.description, JSON.stringify(input.translations), input.selection_mode).run();
    const taxonomy = await getTaxonomy(env, id);
    return successResponse(201, 'CREATED', taxonomy ? parseTaxonomy(taxonomy) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', 'code taxonomy đã tồn tại hoặc dữ liệu không hợp lệ', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateTaxonomy(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readTaxonomyInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = await env.DB.prepare(`
      UPDATE taxonomies
      SET code = ?, name = ?, description = ?, translations = ?, selection_mode = ?
      WHERE id = ?
    `).bind(input.code, input.name, input.description, JSON.stringify(input.translations), input.selection_mode, id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const taxonomy = await getTaxonomy(env, id);
    return successResponse(200, 'UPDATED', taxonomy ? parseTaxonomy(taxonomy) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteTaxonomy(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM taxonomies WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleCreateTaxonomyTerm(request: Request, env: Env, origin: string, taxonomyId: string): Promise<Response> {
  const input = await readTermInput(request, origin);
  if (isResponse(input)) return input;
  const id = generateUUIDv7();
  try {
    if (!await getTaxonomy(env, taxonomyId)) return errorResponse(404, 'NOT_FOUND', 'Taxonomy không tồn tại', origin);
    await env.DB.prepare(`
      INSERT INTO taxonomy_terms (id, taxonomy_id, parent_id, code, name, description, translations, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      taxonomyId,
      input.parent_id,
      input.code,
      input.name,
      input.description,
      JSON.stringify(input.translations),
      input.position,
    ).run();
    const term = await getTerm(env, id);
    return successResponse(201, 'CREATED', term ? parseTerm(term) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', 'Term bị trùng hoặc parent_id không thuộc taxonomy', origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleUpdateTaxonomyTerm(request: Request, env: Env, origin: string, id: string): Promise<Response> {
  const input = await readTermInput(request, origin);
  if (isResponse(input)) return input;
  try {
    const result = await env.DB.prepare(`
      UPDATE taxonomy_terms
      SET parent_id = ?, code = ?, name = ?, description = ?, translations = ?, position = ?
      WHERE id = ?
    `).bind(
      input.parent_id,
      input.code,
      input.name,
      input.description,
      JSON.stringify(input.translations),
      input.position,
      id,
    ).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    const term = await getTerm(env, id);
    return successResponse(200, 'UPDATED', term ? parseTerm(term) : undefined, origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteTaxonomyTerm(env: Env, origin: string, id: string): Promise<Response> {
  try {
    const result = await env.DB.prepare('DELETE FROM taxonomy_terms WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return errorResponse(404, 'NOT_FOUND', undefined, origin);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetPassageTerms(env: Env, origin: string, passageId: string): Promise<Response> {
  try {
    const passage = await env.DB.prepare('SELECT id FROM passages WHERE id = ?').bind(passageId).first<{ id: string }>();
    if (!passage) return errorResponse(404, 'NOT_FOUND', 'Passage không tồn tại', origin);
    return successResponse(200, 'SUCCESS', await getPassageTerms(env, passageId), origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleReplacePassageTerms(request: Request, env: Env, origin: string, passageId: string): Promise<Response> {
  const body = await readBody(request, origin);
  if (isResponse(body)) return body;
  if (!Array.isArray(body.term_ids) || body.term_ids.length > 50) {
    return errorResponse(400, 'VALIDATION_ERROR', 'term_ids phải là mảng tối đa 50 phần tử', origin);
  }
  const termIds = body.term_ids.map(value => typeof value === 'string' ? value.trim() : '');
  if (termIds.some(id => !id) || new Set(termIds).size !== termIds.length) {
    return errorResponse(400, 'VALIDATION_ERROR', 'term_ids phải là các id không rỗng và không trùng nhau', origin);
  }
  try {
    const passage = await env.DB.prepare('SELECT id FROM passages WHERE id = ?').bind(passageId).first<{ id: string }>();
    if (!passage) return errorResponse(404, 'NOT_FOUND', 'Passage không tồn tại', origin);
    if (termIds.length > 0) {
      const placeholders = termIds.map(() => '?').join(', ');
      const rows = await env.DB.prepare(`
        SELECT term.id, term.taxonomy_id, taxonomy.selection_mode
        FROM taxonomy_terms term
        JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
        WHERE term.id IN (${placeholders})
      `).bind(...termIds).all<{ id: string; taxonomy_id: string; selection_mode: 'single' | 'multiple' }>();
      if (rows.results.length !== termIds.length) {
        const found = new Set(rows.results.map(row => row.id));
        return errorResponse(404, 'NOT_FOUND', { term_ids: termIds.filter(id => !found.has(id)) }, origin);
      }
      const singleTaxonomies = new Set<string>();
      for (const row of rows.results) {
        if (row.selection_mode === 'single' && singleTaxonomies.has(row.taxonomy_id)) {
          return errorResponse(409, 'CONFLICT', `Taxonomy ${row.taxonomy_id} chỉ cho phép chọn một term`, origin);
        }
        if (row.selection_mode === 'single') singleTaxonomies.add(row.taxonomy_id);
      }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM passage_terms WHERE passage_id = ?').bind(passageId),
      ...termIds.map(termId => env.DB.prepare('INSERT INTO passage_terms (passage_id, term_id) VALUES (?, ?)').bind(passageId, termId)),
    ]);
    return successResponse(200, 'UPDATED', await getPassageTerms(env, passageId), origin);
  } catch (error) {
    if (isConstraint(error)) return errorResponse(409, 'CONFLICT', error instanceof Error ? error.message : undefined, origin);
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}
