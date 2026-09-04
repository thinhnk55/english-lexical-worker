import { corsResponse, errorResponse } from './utils/response';
import { getOrigin } from './utils/cors';
import { requireAdmin } from './utils/auth';
import {
  handleCreateLexical,
  handleDeleteLexical,
  handleGetLexical,
  handleCheckLexicalDuplicates,
  handleBulkLexicals,
  handleListLexicals,
  handleUpdateLexical,
} from './features/lexicals/handlers';
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
} from './features/sentences/handlers';
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
  handleGetPassageRuntime,
  handleListParagraphSentences,
  handleListPassageParagraphs,
  handleListPassages,
  handlePublishPassageRuntime,
  handleUpdateParagraph,
  handleUpdateParagraphSentence,
  handleUpdatePassage,
} from './features/passages/handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = getOrigin(request);
    if (request.method === 'OPTIONS') return corsResponse(origin);
    if (url.pathname === '/' || url.pathname === '/info') {
      return new Response(JSON.stringify({ name: 'english-lexical-worker', version: '1.0.0' }), {
        headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': origin || '*' },
      });
    }

    // Runtime is a pre-built public representation; only mutation endpoints
    // below require an administrator and may perform joins against source data.
    const passageRuntimeMatch = url.pathname.match(/^\/passages\/([^/]+)\/runtime$/);
    if (passageRuntimeMatch && request.method === 'GET') {
      return handleGetPassageRuntime(env, origin, passageRuntimeMatch[1]);
    }

    const auth = await requireAdmin(request, env, origin);
    if (!auth.ok) return auth.response;

    if (passageRuntimeMatch) {
      if (request.method === 'PUT') return handlePublishPassageRuntime(env, origin, passageRuntimeMatch[1]);
      if (request.method === 'DELETE') return handleDeletePassageRuntime(env, origin, passageRuntimeMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    if (url.pathname === '/lexicals') {
      if (request.method === 'GET') return handleListLexicals(request, env, origin);
      if (request.method === 'POST') return handleCreateLexical(request, env, origin);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    if (url.pathname === '/lexicals/check-duplicates' && request.method === 'POST') {
      return handleCheckLexicalDuplicates(request, env, origin);
    }
    if (url.pathname === '/lexicals/bulk' && request.method === 'POST') {
      return handleBulkLexicals(request, env, origin);
    }

    if (url.pathname === '/sentences') {
      if (request.method === 'GET') return handleListSentences(request, env, origin);
      if (request.method === 'POST') return handleCreateSentence(request, env, origin);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    if (url.pathname === '/passages') {
      if (request.method === 'GET') return handleListPassages(request, env, origin);
      if (request.method === 'POST') return handleCreatePassage(request, env, origin);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const passageParagraphsMatch = url.pathname.match(/^\/passages\/([^/]+)\/paragraphs$/);
    if (passageParagraphsMatch) {
      if (request.method === 'GET') return handleListPassageParagraphs(env, origin, passageParagraphsMatch[1]);
      if (request.method === 'POST') return handleCreateParagraph(request, env, origin, passageParagraphsMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const paragraphSentencesMatch = url.pathname.match(/^\/paragraphs\/([^/]+)\/sentences$/);
    if (paragraphSentencesMatch) {
      if (request.method === 'GET') return handleListParagraphSentences(env, origin, paragraphSentencesMatch[1]);
      if (request.method === 'POST') return handleCreateParagraphSentence(request, env, origin, paragraphSentencesMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const sentenceLexicalsMatch = url.pathname.match(/^\/sentences\/([^/]+)\/lexicals$/);
    if (sentenceLexicalsMatch) {
      if (request.method === 'GET') return handleListSentenceLexicals(env, origin, sentenceLexicalsMatch[1]);
      if (request.method === 'POST') return handleCreateSentenceLexical(request, env, origin, sentenceLexicalsMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const match = url.pathname.match(/^\/lexicals\/([^/]+)$/);
    if (match) {
      if (request.method === 'GET') return handleGetLexical(env, origin, match[1]);
      if (request.method === 'PUT') return handleUpdateLexical(request, env, origin, match[1]);
      if (request.method === 'DELETE') return handleDeleteLexical(env, origin, match[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const sentenceLexicalMatch = url.pathname.match(/^\/sentence-lexicals\/([^/]+)$/);
    if (sentenceLexicalMatch) {
      if (request.method === 'PUT') return handleUpdateSentenceLexical(request, env, origin, sentenceLexicalMatch[1]);
      if (request.method === 'DELETE') return handleDeleteSentenceLexical(env, origin, sentenceLexicalMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const sentenceMatch = url.pathname.match(/^\/sentences\/([^/]+)$/);
    if (sentenceMatch) {
      if (request.method === 'GET') return handleGetSentence(env, origin, sentenceMatch[1]);
      if (request.method === 'PUT') return handleUpdateSentence(request, env, origin, sentenceMatch[1]);
      if (request.method === 'DELETE') return handleDeleteSentence(env, origin, sentenceMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const paragraphSentenceMatch = url.pathname.match(/^\/paragraph-sentences\/([^/]+)$/);
    if (paragraphSentenceMatch) {
      if (request.method === 'PUT') return handleUpdateParagraphSentence(request, env, origin, paragraphSentenceMatch[1]);
      if (request.method === 'DELETE') return handleDeleteParagraphSentence(env, origin, paragraphSentenceMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const paragraphMatch = url.pathname.match(/^\/paragraphs\/([^/]+)$/);
    if (paragraphMatch) {
      if (request.method === 'GET') return handleGetParagraph(env, origin, paragraphMatch[1]);
      if (request.method === 'PUT') return handleUpdateParagraph(request, env, origin, paragraphMatch[1]);
      if (request.method === 'DELETE') return handleDeleteParagraph(env, origin, paragraphMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const passageMatch = url.pathname.match(/^\/passages\/([^/]+)$/);
    if (passageMatch) {
      if (request.method === 'GET') return handleGetPassage(env, origin, passageMatch[1]);
      if (request.method === 'PUT') return handleUpdatePassage(request, env, origin, passageMatch[1]);
      if (request.method === 'DELETE') return handleDeletePassage(env, origin, passageMatch[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    return errorResponse(404, 'NOT_FOUND', 'Endpoint not found', origin);
  },
} satisfies ExportedHandler<Env>;
