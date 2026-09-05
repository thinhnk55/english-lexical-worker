import { handleGetTaxonomy, handleListTaxonomies } from '../features/classification/handlers';
import {
  handleAbandonActiveReading,
  handleCheckIn,
  handleCompleteActiveReading,
  handleGetActiveReading,
  handleGetLearnerProfile,
  handleGetPublishedPassage,
  handleGetPublishedRoadmap,
  handleGetReadingHistoryItem,
  handleGetReadingSummary,
  handleListPublishedPassages,
  handleListPublishedRoadmaps,
  handleListReadingHistory,
  handleStartReading,
  handleUpdateActiveReadingActivity,
} from '../features/learning/handlers';
import {
  handleDeleteLearnerLexical,
  handleListLearnerLexicals,
  handleSaveLearnerLexical,
  handleSelectLearnerLexicalsForReview,
  handleUpdateLearnerLexicalReviewResults,
} from '../features/learner-lexicals/handlers';
import { errorResponse } from '../utils/response';

function methodNotAllowed(origin: string): Response {
  return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
}

export async function routeUserRequest(
  request: Request,
  env: Env,
  origin: string,
  pathname: string,
  userId: string,
): Promise<Response> {
  const path = pathname.slice('/v1'.length) || '/';

  if (path === '/passages') {
    return request.method === 'GET' ? handleListPublishedPassages(request, env, origin) : methodNotAllowed(origin);
  }
  const passageMatch = path.match(/^\/passages\/([^/]+)$/);
  if (passageMatch) {
    return request.method === 'GET' ? handleGetPublishedPassage(env, origin, passageMatch[1]) : methodNotAllowed(origin);
  }

  if (path === '/taxonomies') {
    return request.method === 'GET' ? handleListTaxonomies(request, env, origin) : methodNotAllowed(origin);
  }
  const taxonomyMatch = path.match(/^\/taxonomies\/([^/]+)$/);
  if (taxonomyMatch) {
    return request.method === 'GET' ? handleGetTaxonomy(env, origin, taxonomyMatch[1]) : methodNotAllowed(origin);
  }

  if (path === '/roadmaps') {
    return request.method === 'GET'
      ? handleListPublishedRoadmaps(request, env, origin, userId)
      : methodNotAllowed(origin);
  }
  const roadmapMatch = path.match(/^\/roadmaps\/([^/]+)$/);
  if (roadmapMatch) {
    return request.method === 'GET'
      ? handleGetPublishedRoadmap(env, origin, userId, roadmapMatch[1])
      : methodNotAllowed(origin);
  }

  if (path === '/me/reading/active') {
    if (request.method === 'GET') return handleGetActiveReading(env, origin, userId);
    if (request.method === 'POST') return handleStartReading(request, env, origin, userId);
    if (request.method === 'DELETE') return handleAbandonActiveReading(env, origin, userId);
    return methodNotAllowed(origin);
  }
  if (path === '/me/reading/active/complete') {
    return request.method === 'POST' ? handleCompleteActiveReading(env, origin, userId) : methodNotAllowed(origin);
  }
  const activeActivityMatch = path.match(/^\/me\/reading\/active\/activities\/([^/]+)$/);
  if (activeActivityMatch) {
    return request.method === 'PUT'
      ? handleUpdateActiveReadingActivity(request, env, origin, userId, activeActivityMatch[1])
      : methodNotAllowed(origin);
  }
  if (path === '/me/reading/history') {
    return request.method === 'GET' ? handleListReadingHistory(request, env, origin, userId) : methodNotAllowed(origin);
  }
  const historyItemMatch = path.match(/^\/me\/reading\/history\/([^/]+)$/);
  if (historyItemMatch) {
    return request.method === 'GET'
      ? handleGetReadingHistoryItem(env, origin, userId, historyItemMatch[1])
      : methodNotAllowed(origin);
  }
  if (path === '/me/reading/summary') {
    return request.method === 'GET' ? handleGetReadingSummary(env, origin, userId) : methodNotAllowed(origin);
  }
  if (path === '/me/profile') {
    return request.method === 'GET' ? handleGetLearnerProfile(env, origin, userId) : methodNotAllowed(origin);
  }
  if (path === '/me/reading/check-in') {
    return request.method === 'POST' ? handleCheckIn(env, origin, userId) : methodNotAllowed(origin);
  }

  if (path === '/me/lexicals/review') {
    if (request.method === 'GET') return handleSelectLearnerLexicalsForReview(request, env, origin, userId);
    if (request.method === 'PUT') return handleUpdateLearnerLexicalReviewResults(request, env, origin, userId);
    return methodNotAllowed(origin);
  }
  if (path === '/me/lexicals') {
    if (request.method === 'GET') return handleListLearnerLexicals(request, env, origin, userId);
    if (request.method === 'POST') return handleSaveLearnerLexical(request, env, origin, userId);
    return methodNotAllowed(origin);
  }
  const learnerLexicalMatch = path.match(/^\/me\/lexicals\/([^/]+)$/);
  if (learnerLexicalMatch) {
    return request.method === 'DELETE'
      ? handleDeleteLearnerLexical(env, origin, userId, learnerLexicalMatch[1])
      : methodNotAllowed(origin);
  }

  return errorResponse(404, 'NOT_FOUND', 'User endpoint not found', origin);
}
