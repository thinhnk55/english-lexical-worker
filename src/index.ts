import { corsResponse, errorResponse } from './utils/response';
import { getOrigin } from './utils/cors';
import { requireAdmin } from './utils/auth';
import {
  handleCreateLexical,
  handleDeleteLexical,
  handleGetLexical,
  handleListLexicals,
  handleUpdateLexical,
} from './features/lexicals/handlers';

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

    const auth = await requireAdmin(request, env, origin);
    if (!auth.ok) return auth.response;

    if (url.pathname === '/lexicals') {
      if (request.method === 'GET') return handleListLexicals(request, env, origin);
      if (request.method === 'POST') return handleCreateLexical(request, env, origin);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    const match = url.pathname.match(/^\/lexicals\/([^/]+)$/);
    if (match) {
      if (request.method === 'GET') return handleGetLexical(env, origin, match[1]);
      if (request.method === 'PUT') return handleUpdateLexical(request, env, origin, match[1]);
      if (request.method === 'DELETE') return handleDeleteLexical(env, origin, match[1]);
      return errorResponse(405, 'BAD_REQUEST', 'Method not allowed', origin);
    }

    return errorResponse(404, 'NOT_FOUND', 'Endpoint not found', origin);
  },
} satisfies ExportedHandler<Env>;
