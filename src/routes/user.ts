import { handleGetTaxonomy, handleListTaxonomies } from '../features/classification/handlers';
import {
  handleCheckIn,
  handleGetLearnerProfile,
  handleGetLearnerPassageProgress,
  handleGetPublishedPassage,
  handleGetPublishedRoadmap,
  handleGetReadingSummary,
  handleListLearnerPassages,
  handleListPublishedPassages,
  handleListPublishedRoadmaps,
  handleCompleteLearnerPassage,
  handleUpdateLearnerPassageProgress,
} from '../features/learning/handlers';
import {
  handleDeleteLearnerLexical,
  handleListLearnerLexicals,
  handleSaveLearnerLexical,
  handleSelectLearnerLexicalsForReview,
  handleUpdateLearnerLexicalReviewResults,
} from '../features/learner-lexicals/handlers';
import { handleAssessReadAloud } from '../features/learning/readAloud';
import {
  handleAssessLexicalPronunciation,
  handleAssessLexicalRecognition,
} from '../features/lexicals/assessment';
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
  userRole?: string,
): Promise<Response> {
  const path = pathname.slice('/v1'.length) || '/';

  if (path === '/me/read-aloud/assess') {
    return request.method === 'POST'
      ? handleAssessReadAloud(request, env, origin, userRole === 'admin' || userRole === 'super_admin')
      : methodNotAllowed(origin);
  }

  const lexicalAssessmentMatch = path.match(/^\/me\/passages\/([^/]+)\/lexicals\/([^/]+)\/(pronunciation|recognition)\/assess$/);
  if (lexicalAssessmentMatch) {
    if (request.method !== 'POST') return methodNotAllowed(origin);
    const allowUnpublished = userRole === 'admin' || userRole === 'super_admin';
    return lexicalAssessmentMatch[3] === 'pronunciation'
      ? handleAssessLexicalPronunciation(request, env, origin, lexicalAssessmentMatch[1], lexicalAssessmentMatch[2], allowUnpublished)
      : handleAssessLexicalRecognition(request, env, origin, lexicalAssessmentMatch[1], lexicalAssessmentMatch[2], allowUnpublished);
  }

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

  if (path === '/me/passages') {
    return request.method === 'GET' ? handleListLearnerPassages(request, env, origin, userId) : methodNotAllowed(origin);
  }
  const learnerPassageProgressMatch = path.match(/^\/me\/passages\/([^/]+)\/progress$/);
  if (learnerPassageProgressMatch) {
    if (request.method === 'GET') return handleGetLearnerPassageProgress(env, origin, userId, learnerPassageProgressMatch[1]);
    if (request.method === 'PUT') return handleUpdateLearnerPassageProgress(request, env, origin, userId, learnerPassageProgressMatch[1]);
    return methodNotAllowed(origin);
  }
  const learnerPassageCompleteMatch = path.match(/^\/me\/passages\/([^/]+)\/complete$/);
  if (learnerPassageCompleteMatch) {
    return request.method === 'POST'
      ? handleCompleteLearnerPassage(request, env, origin, userId, learnerPassageCompleteMatch[1])
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
