import { routeAdminRequest } from './routes/admin';
import { routeUserRequest } from './routes/user';
import { requireAdmin, requireUser } from './utils/auth';
import { getCorsOrigin } from './utils/cors';
import { corsResponse, errorResponse } from './utils/response';
import { handleGetAsset } from './features/media/handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = getCorsOrigin(request);
    const origin = cors.origin;

    if (!cors.allowed) return errorResponse(403, 'FORBIDDEN', 'Origin không được phép', '');

    if (request.method === 'OPTIONS') return corsResponse(origin);

    if (url.pathname === '/' || url.pathname === '/info') {
      return new Response(JSON.stringify({
        name: 'english-lexical-worker',
        version: '2.5.1',
        api: {
          admin: '/v1/admin',
          user: '/v1',
        },
      }), {
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/assets/')) {
      let key: string;
      try {
        key = decodeURIComponent(url.pathname.slice('/assets/'.length));
      } catch {
        return errorResponse(400, 'BAD_REQUEST', 'Asset path không hợp lệ', origin);
      }
      return handleGetAsset(request, env, origin, key);
    }

    if (url.pathname === '/v1/admin' || url.pathname.startsWith('/v1/admin/')) {
      const auth = await requireAdmin(request, env, origin);
      if (!auth.ok) return auth.response;
      return routeAdminRequest(request, env, origin, url.pathname);
    }

    if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
      const auth = await requireUser(request, env, origin);
      if (!auth.ok) return auth.response;
      return routeUserRequest(request, env, origin, url.pathname, auth.payload.sub, auth.payload.role);
    }

    return errorResponse(404, 'NOT_FOUND', 'Endpoint not found', origin);
  },
} satisfies ExportedHandler<Env>;
