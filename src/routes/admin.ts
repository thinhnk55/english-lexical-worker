import {
  handleCreatePassageActivity,
  handleDeletePassageActivity,
  handleGetPassageActivity,
  handleListPassageActivities,
  handleUpdatePassageActivity,
} from '../features/activities/handlers';
import {
  handleCreateTaxonomy,
  handleCreateTaxonomyTerm,
  handleDeleteTaxonomy,
  handleDeleteTaxonomyTerm,
  handleGetPassageTerms,
  handleGetTaxonomy,
  handleListTaxonomies,
  handleReplacePassageTerms,
  handleUpdateTaxonomy,
  handleUpdateTaxonomyTerm,
} from '../features/classification/handlers';
import {
  handleBulkLexicals,
  handleCheckLexicalDuplicates,
  handleCreateLexical,
  handleDeleteLexical,
  handleGetLexical,
  handleListLexicals,
  handleUpdateLexical,
} from '../features/lexicals/handlers';
import {
  handleCommitPassageImport,
  handlePreviewPassageImport,
} from '../features/passage-import/handlers';
import {
  handleCreateParagraph,
  handleCreateParagraphSentence,
  handleCreatePassage,
  handleDeleteParagraph,
  handleDeleteParagraphSentence,
  handleDeletePassage,
  handleDeletePassageRuntime,
  handleGetParagraph,
  handleGetPassage,
  handleListParagraphSentences,
  handleListPassageParagraphs,
  handleListPassages,
  handlePublishPassageRuntime,
  handleUpdateParagraph,
  handleUpdateParagraphSentence,
  handleUpdatePassage,
} from '../features/passages/handlers';
import {
  handleCreateRoadmap,
  handleCreateRoadmapPassage,
  handleDeleteRoadmap,
  handleDeleteRoadmapPassage,
  handleGetAdminRoadmap,
  handleGetRoadmapPassage,
  handleListAdminRoadmaps,
  handleListRoadmapPassages,
  handleSetRoadmapLifecycle,
  handleUpdateRoadmap,
  handleUpdateRoadmapPassage,
} from '../features/roadmaps/handlers';
import {
  handleCreateSentence,
  handleCreateSentenceLexical,
  handleDeleteSentence,
  handleDeleteSentenceLexical,
  handleGetSentence,
  handleListSentenceLexicals,
  handleListSentences,
  handleUpdateSentence,
  handleUpdateSentenceLexical,
} from '../features/sentences/handlers';
import { errorResponse } from '../utils/response';

function methodNotAllowed(origin: string): Response {
  return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
}

export async function routeAdminRequest(request: Request, env: Env, origin: string, pathname: string): Promise<Response> {
  const path = pathname.slice('/v1/admin'.length) || '/';

  if (path === '/lexicals/check-duplicates') {
    return request.method === 'POST' ? handleCheckLexicalDuplicates(request, env, origin) : methodNotAllowed(origin);
  }
  if (path === '/lexicals/bulk') {
    return request.method === 'POST' ? handleBulkLexicals(request, env, origin) : methodNotAllowed(origin);
  }
  if (path === '/lexicals') {
    if (request.method === 'GET') return handleListLexicals(request, env, origin);
    if (request.method === 'POST') return handleCreateLexical(request, env, origin);
    return methodNotAllowed(origin);
  }
  const lexicalMatch = path.match(/^\/lexicals\/([^/]+)$/);
  if (lexicalMatch) {
    if (request.method === 'GET') return handleGetLexical(env, origin, lexicalMatch[1]);
    if (request.method === 'PUT') return handleUpdateLexical(request, env, origin, lexicalMatch[1]);
    if (request.method === 'DELETE') return handleDeleteLexical(env, origin, lexicalMatch[1]);
    return methodNotAllowed(origin);
  }

  if (path === '/sentences') {
    if (request.method === 'GET') return handleListSentences(request, env, origin);
    if (request.method === 'POST') return handleCreateSentence(request, env, origin);
    return methodNotAllowed(origin);
  }
  const sentenceLexicalsMatch = path.match(/^\/sentences\/([^/]+)\/lexicals$/);
  if (sentenceLexicalsMatch) {
    if (request.method === 'GET') return handleListSentenceLexicals(env, origin, sentenceLexicalsMatch[1]);
    if (request.method === 'POST') return handleCreateSentenceLexical(request, env, origin, sentenceLexicalsMatch[1]);
    return methodNotAllowed(origin);
  }
  const sentenceMatch = path.match(/^\/sentences\/([^/]+)$/);
  if (sentenceMatch) {
    if (request.method === 'GET') return handleGetSentence(env, origin, sentenceMatch[1]);
    if (request.method === 'PUT') return handleUpdateSentence(request, env, origin, sentenceMatch[1]);
    if (request.method === 'DELETE') return handleDeleteSentence(env, origin, sentenceMatch[1]);
    return methodNotAllowed(origin);
  }
  const sentenceLexicalMatch = path.match(/^\/sentence-lexicals\/([^/]+)$/);
  if (sentenceLexicalMatch) {
    if (request.method === 'PUT') return handleUpdateSentenceLexical(request, env, origin, sentenceLexicalMatch[1]);
    if (request.method === 'DELETE') return handleDeleteSentenceLexical(env, origin, sentenceLexicalMatch[1]);
    return methodNotAllowed(origin);
  }

  if (path === '/passages') {
    if (request.method === 'GET') return handleListPassages(request, env, origin);
    if (request.method === 'POST') return handleCreatePassage(request, env, origin);
    return methodNotAllowed(origin);
  }
  if (path === '/passages/import/preview') {
    return request.method === 'POST' ? handlePreviewPassageImport(request, env, origin) : methodNotAllowed(origin);
  }
  if (path === '/passages/import') {
    return request.method === 'POST' ? handleCommitPassageImport(request, env, origin) : methodNotAllowed(origin);
  }
  const passageRuntimeMatch = path.match(/^\/passages\/([^/]+)\/runtime$/);
  if (passageRuntimeMatch) {
    if (request.method === 'PUT') return handlePublishPassageRuntime(env, origin, passageRuntimeMatch[1]);
    if (request.method === 'DELETE') return handleDeletePassageRuntime(env, origin, passageRuntimeMatch[1]);
    return methodNotAllowed(origin);
  }
  const passageTermsMatch = path.match(/^\/passages\/([^/]+)\/terms$/);
  if (passageTermsMatch) {
    if (request.method === 'GET') return handleGetPassageTerms(env, origin, passageTermsMatch[1]);
    if (request.method === 'PUT') return handleReplacePassageTerms(request, env, origin, passageTermsMatch[1]);
    return methodNotAllowed(origin);
  }
  const passageActivitiesMatch = path.match(/^\/passages\/([^/]+)\/activities$/);
  if (passageActivitiesMatch) {
    if (request.method === 'GET') return handleListPassageActivities(env, origin, passageActivitiesMatch[1]);
    if (request.method === 'POST') return handleCreatePassageActivity(request, env, origin, passageActivitiesMatch[1]);
    return methodNotAllowed(origin);
  }
  const passageParagraphsMatch = path.match(/^\/passages\/([^/]+)\/paragraphs$/);
  if (passageParagraphsMatch) {
    if (request.method === 'GET') return handleListPassageParagraphs(env, origin, passageParagraphsMatch[1]);
    if (request.method === 'POST') return handleCreateParagraph(request, env, origin, passageParagraphsMatch[1]);
    return methodNotAllowed(origin);
  }
  const passageMatch = path.match(/^\/passages\/([^/]+)$/);
  if (passageMatch) {
    if (request.method === 'GET') return handleGetPassage(env, origin, passageMatch[1]);
    if (request.method === 'PUT') return handleUpdatePassage(request, env, origin, passageMatch[1]);
    if (request.method === 'DELETE') return handleDeletePassage(env, origin, passageMatch[1]);
    return methodNotAllowed(origin);
  }

  const activityMatch = path.match(/^\/activities\/([^/]+)$/);
  if (activityMatch) {
    if (request.method === 'GET') return handleGetPassageActivity(env, origin, activityMatch[1]);
    if (request.method === 'PUT') return handleUpdatePassageActivity(request, env, origin, activityMatch[1]);
    if (request.method === 'DELETE') return handleDeletePassageActivity(env, origin, activityMatch[1]);
    return methodNotAllowed(origin);
  }
  const paragraphSentencesMatch = path.match(/^\/paragraphs\/([^/]+)\/sentences$/);
  if (paragraphSentencesMatch) {
    if (request.method === 'GET') return handleListParagraphSentences(env, origin, paragraphSentencesMatch[1]);
    if (request.method === 'POST') return handleCreateParagraphSentence(request, env, origin, paragraphSentencesMatch[1]);
    return methodNotAllowed(origin);
  }
  const paragraphMatch = path.match(/^\/paragraphs\/([^/]+)$/);
  if (paragraphMatch) {
    if (request.method === 'GET') return handleGetParagraph(env, origin, paragraphMatch[1]);
    if (request.method === 'PUT') return handleUpdateParagraph(request, env, origin, paragraphMatch[1]);
    if (request.method === 'DELETE') return handleDeleteParagraph(env, origin, paragraphMatch[1]);
    return methodNotAllowed(origin);
  }
  const paragraphSentenceMatch = path.match(/^\/paragraph-sentences\/([^/]+)$/);
  if (paragraphSentenceMatch) {
    if (request.method === 'PUT') return handleUpdateParagraphSentence(request, env, origin, paragraphSentenceMatch[1]);
    if (request.method === 'DELETE') return handleDeleteParagraphSentence(env, origin, paragraphSentenceMatch[1]);
    return methodNotAllowed(origin);
  }

  if (path === '/taxonomies') {
    if (request.method === 'GET') return handleListTaxonomies(request, env, origin);
    if (request.method === 'POST') return handleCreateTaxonomy(request, env, origin);
    return methodNotAllowed(origin);
  }
  const taxonomyTermsMatch = path.match(/^\/taxonomies\/([^/]+)\/terms$/);
  if (taxonomyTermsMatch) {
    return request.method === 'POST'
      ? handleCreateTaxonomyTerm(request, env, origin, taxonomyTermsMatch[1])
      : methodNotAllowed(origin);
  }
  const taxonomyMatch = path.match(/^\/taxonomies\/([^/]+)$/);
  if (taxonomyMatch) {
    if (request.method === 'GET') return handleGetTaxonomy(env, origin, taxonomyMatch[1]);
    if (request.method === 'PUT') return handleUpdateTaxonomy(request, env, origin, taxonomyMatch[1]);
    if (request.method === 'DELETE') return handleDeleteTaxonomy(env, origin, taxonomyMatch[1]);
    return methodNotAllowed(origin);
  }
  const taxonomyTermMatch = path.match(/^\/taxonomy-terms\/([^/]+)$/);
  if (taxonomyTermMatch) {
    if (request.method === 'PUT') return handleUpdateTaxonomyTerm(request, env, origin, taxonomyTermMatch[1]);
    if (request.method === 'DELETE') return handleDeleteTaxonomyTerm(env, origin, taxonomyTermMatch[1]);
    return methodNotAllowed(origin);
  }

  if (path === '/roadmaps') {
    if (request.method === 'GET') return handleListAdminRoadmaps(request, env, origin);
    if (request.method === 'POST') return handleCreateRoadmap(request, env, origin);
    return methodNotAllowed(origin);
  }
  const roadmapLifecycleMatch = path.match(/^\/roadmaps\/([^/]+)\/(publish|unpublish|archive|unarchive)$/);
  if (roadmapLifecycleMatch) {
    return request.method === 'POST'
      ? handleSetRoadmapLifecycle(
        env,
        origin,
        roadmapLifecycleMatch[1],
        roadmapLifecycleMatch[2] as 'publish' | 'unpublish' | 'archive' | 'unarchive',
      )
      : methodNotAllowed(origin);
  }
  const roadmapPassagesMatch = path.match(/^\/roadmaps\/([^/]+)\/passages$/);
  if (roadmapPassagesMatch) {
    if (request.method === 'GET') return handleListRoadmapPassages(env, origin, roadmapPassagesMatch[1]);
    if (request.method === 'POST') return handleCreateRoadmapPassage(request, env, origin, roadmapPassagesMatch[1]);
    return methodNotAllowed(origin);
  }
  const roadmapMatch = path.match(/^\/roadmaps\/([^/]+)$/);
  if (roadmapMatch) {
    if (request.method === 'GET') return handleGetAdminRoadmap(env, origin, roadmapMatch[1]);
    if (request.method === 'PUT') return handleUpdateRoadmap(request, env, origin, roadmapMatch[1]);
    if (request.method === 'DELETE') return handleDeleteRoadmap(env, origin, roadmapMatch[1]);
    return methodNotAllowed(origin);
  }
  const roadmapPassageMatch = path.match(/^\/roadmap-passages\/([^/]+)$/);
  if (roadmapPassageMatch) {
    if (request.method === 'GET') return handleGetRoadmapPassage(env, origin, roadmapPassageMatch[1]);
    if (request.method === 'PUT') return handleUpdateRoadmapPassage(request, env, origin, roadmapPassageMatch[1]);
    if (request.method === 'DELETE') return handleDeleteRoadmapPassage(env, origin, roadmapPassageMatch[1]);
    return methodNotAllowed(origin);
  }

  return errorResponse(404, 'NOT_FOUND', 'Admin endpoint not found', origin);
}
