export type AssetEntity = 'roadmaps' | 'passages' | 'paragraphs' | 'sentences' | 'lexicals';
export type AssetKind = 'audio' | 'image';

const ENTITY_KINDS: Record<AssetEntity, readonly AssetKind[]> = {
  roadmaps: ['image'],
  passages: ['image'],
  paragraphs: ['image'],
  sentences: ['audio', 'image'],
  lexicals: ['audio', 'image'],
};

const CONTENT_TYPES: Record<AssetKind, string> = {
  audio: 'audio/opus',
  image: 'image/avif',
};

export function isAssetEntity(value: string): value is AssetEntity {
  return value in ENTITY_KINDS;
}

export function supportsAssetKind(entity: AssetEntity, kind: string): kind is AssetKind {
  return ENTITY_KINDS[entity].includes(kind as AssetKind);
}

export function assetContentType(kind: AssetKind): string {
  return CONTENT_TYPES[kind];
}

export function assetKey(entity: AssetEntity, id: string, kind: AssetKind): string {
  return `${entity}/${id}/${kind}.${kind === 'audio' ? 'opus' : 'avif'}`;
}

export function nextAssetUrl(baseUrl: string, key: string, currentUrl: string | null): string {
  const canonicalUrl = `${baseUrl.replace(/\/$/, '')}/${key}`;
  if (!currentUrl) return canonicalUrl;

  try {
    const currentVersion = Number(new URL(currentUrl).searchParams.get('v'));
    const nextVersion = Number.isSafeInteger(currentVersion) && currentVersion >= 2
      ? currentVersion + 1
      : 2;
    return `${canonicalUrl}?v=${nextVersion}`;
  } catch {
    return `${canonicalUrl}?v=2`;
  }
}

export function entityAssetKeys(entity: AssetEntity, id: string): string[] {
  return ENTITY_KINDS[entity].map(kind => assetKey(entity, id, kind));
}

export async function deleteAssetKeys(env: Env, keys: Iterable<string>): Promise<void> {
  const uniqueKeys = [...new Set(keys)];
  for (let index = 0; index < uniqueKeys.length; index += 500) {
    await env.ASSETS.delete(uniqueKeys.slice(index, index + 500));
  }
}

export async function orphanLexicalIdsAfterSentenceDeletion(
  env: Env,
  lexicalIds: Iterable<string>,
  deletedSentenceIds: Iterable<string>,
): Promise<string[]> {
  const sentenceIds = [...new Set(deletedSentenceIds)];
  if (sentenceIds.length === 0) return [];
  const placeholders = sentenceIds.map(() => '?').join(', ');
  const orphanIds: string[] = [];
  for (const lexicalId of new Set(lexicalIds)) {
    const retained = await env.DB.prepare(`
      SELECT
        EXISTS(
          SELECT 1 FROM sentence_lexicals
          WHERE lexical_id = ? AND sentence_id NOT IN (${placeholders})
        ) AS has_sentence,
        EXISTS(SELECT 1 FROM learner_lexicals WHERE lexical_id = ?) AS has_learner
    `).bind(lexicalId, ...sentenceIds, lexicalId).first<{ has_sentence: number; has_learner: number }>();
    if (!retained?.has_sentence && !retained?.has_learner) orphanIds.push(lexicalId);
  }
  return orphanIds;
}

export async function orphanLexicalIdsAfterMappingDeletion(
  env: Env,
  lexicalIds: Iterable<string>,
  deletedMappingIds: Iterable<string>,
): Promise<string[]> {
  const mappingIds = [...new Set(deletedMappingIds)];
  if (mappingIds.length === 0) return [];
  const placeholders = mappingIds.map(() => '?').join(', ');
  const orphanIds: string[] = [];
  for (const lexicalId of new Set(lexicalIds)) {
    const retained = await env.DB.prepare(`
      SELECT
        EXISTS(
          SELECT 1 FROM sentence_lexicals
          WHERE lexical_id = ? AND id NOT IN (${placeholders})
        ) AS has_sentence,
        EXISTS(SELECT 1 FROM learner_lexicals WHERE lexical_id = ?) AS has_learner
    `).bind(lexicalId, ...mappingIds, lexicalId).first<{ has_sentence: number; has_learner: number }>();
    if (!retained?.has_sentence && !retained?.has_learner) orphanIds.push(lexicalId);
  }
  return orphanIds;
}
