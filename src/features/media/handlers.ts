import { invalidateRuntimeStatements, passageIdsForLexical, passageIdsForSentence } from '../authoring/context';
import { buildCorsHeaders } from '../../utils/cors';
import { errorResponse, successResponse } from '../../utils/response';
import { generateUUIDv7 } from '../../utils/uuid';
import {
  assetContentType,
  assetKey,
  deleteAssetKeys,
  isAssetEntity,
  supportsAssetKind,
  type AssetEntity,
  type AssetKind,
} from './assets';

const MAX_ASSET_BYTES = 15 * 1024 * 1024;

const ENTITY_TABLE: Record<AssetEntity, string> = {
  passages: 'passages',
  paragraphs: 'paragraphs',
  sentences: 'sentences',
  lexicals: 'lexicals',
};

async function entityExists(env: Env, entity: AssetEntity, id: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM ${ENTITY_TABLE[entity]} WHERE id = ?`).bind(id).first<{ id: string }>();
  return Boolean(row);
}

async function passageIdsForAsset(env: Env, entity: AssetEntity, id: string): Promise<string[]> {
  if (entity === 'passages') return [id];
  if (entity === 'sentences') return passageIdsForSentence(env, id);
  if (entity === 'lexicals') return passageIdsForLexical(env, id);
  const row = await env.DB.prepare('SELECT passage_id FROM paragraphs WHERE id = ?').bind(id).first<{ passage_id: string }>();
  return row ? [row.passage_id] : [];
}

function readTarget(entityValue: string, kindValue: string): { entity: AssetEntity; kind: AssetKind } | null {
  if (!isAssetEntity(entityValue) || !supportsAssetKind(entityValue, kindValue)) return null;
  return { entity: entityValue, kind: kindValue };
}

export async function handlePutAsset(
  request: Request,
  env: Env,
  origin: string,
  entityValue: string,
  id: string,
  kindValue: string,
): Promise<Response> {
  const target = readTarget(entityValue, kindValue);
  if (!target) return errorResponse(400, 'VALIDATION_ERROR', 'Loại asset không được hỗ trợ', origin);
  if (!await entityExists(env, target.entity, id)) return errorResponse(404, 'NOT_FOUND', undefined, origin);

  const expectedType = assetContentType(target.kind);
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== expectedType) {
    return errorResponse(415, 'VALIDATION_ERROR', `Asset ${target.kind} phải có Content-Type ${expectedType}`, origin);
  }
  const contentLength = Number(request.headers.get('Content-Length'));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > MAX_ASSET_BYTES || !request.body) {
    return errorResponse(413, 'VALIDATION_ERROR', 'Asset phải có dung lượng từ 1 byte đến 15 MB', origin);
  }

  const key = assetKey(target.entity, id, target.kind);
  try {
    await env.ASSETS.put(key, request.body, {
      httpMetadata: { contentType: expectedType },
      customMetadata: { entity: target.entity, entityId: id, kind: target.kind },
    });
    const version = generateUUIDv7();
    const url = `${env.ASSET_BASE_URL}/${key}?v=${version}`;
    const passageIds = await passageIdsForAsset(env, target.entity, id);
    await env.DB.batch([
      env.DB.prepare(`UPDATE ${ENTITY_TABLE[target.entity]} SET ${target.kind} = ? WHERE id = ?`).bind(url, id),
      ...invalidateRuntimeStatements(env, passageIds),
    ]);
    return successResponse(200, 'UPDATED', { key, url }, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleDeleteAsset(
  env: Env,
  origin: string,
  entityValue: string,
  id: string,
  kindValue: string,
): Promise<Response> {
  const target = readTarget(entityValue, kindValue);
  if (!target) return errorResponse(400, 'VALIDATION_ERROR', 'Loại asset không được hỗ trợ', origin);
  if (!await entityExists(env, target.entity, id)) return errorResponse(404, 'NOT_FOUND', undefined, origin);
  try {
    await deleteAssetKeys(env, [assetKey(target.entity, id, target.kind)]);
    const passageIds = await passageIdsForAsset(env, target.entity, id);
    await env.DB.batch([
      env.DB.prepare(`UPDATE ${ENTITY_TABLE[target.entity]} SET ${target.kind} = NULL WHERE id = ?`).bind(id),
      ...invalidateRuntimeStatements(env, passageIds),
    ]);
    return successResponse(200, 'DELETED', undefined, origin);
  } catch (error) {
    return errorResponse(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : undefined, origin);
  }
}

export async function handleGetAsset(request: Request, env: Env, origin: string, key: string): Promise<Response> {
  if (!/^(passages|paragraphs|sentences|lexicals)\/[A-Za-z0-9_-]{1,128}\/(audio\.opus|image\.avif)$/.test(key)) {
    return errorResponse(404, 'NOT_FOUND', undefined, origin);
  }
  const wantsRange = request.headers.has('Range');
  const object = await env.ASSETS.get(key, wantsRange ? { range: request.headers } : undefined);
  if (!object) return errorResponse(404, 'NOT_FOUND', undefined, origin);
  const headers = new Headers(buildCorsHeaders(origin));
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Accept-Ranges', 'bytes');
  let status = 200;
  if (object.range && 'offset' in object.range && object.range.offset !== undefined && 'length' in object.range && typeof object.range.length === 'number') {
    const length = object.range.length;
    headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else {
    headers.set('Content-Length', String(object.size));
  }
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  return new Response(object.body, { status, headers });
}
