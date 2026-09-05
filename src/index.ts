import { routeAdminRequest } from './routes/admin';
import { routeUserRequest } from './routes/user';
import { requireAdmin, requireUser } from './utils/auth';
import { getOrigin } from './utils/cors';
import { corsResponse, errorResponse } from './utils/response';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = getOrigin(request);

    if (request.method === 'OPTIONS') return corsResponse(origin);

    if (url.pathname === '/' || url.pathname === '/info') {
      return new Response(JSON.stringify({
        name: 'english-lexical-worker',
        version: '1.0.0',
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

    if (url.pathname === '/v1/admin' || url.pathname.startsWith('/v1/admin/')) {
      const auth = await requireAdmin(request, env, origin);
      if (!auth.ok) return auth.response;
      return routeAdminRequest(request, env, origin, url.pathname);
    }

    if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
      const auth = await requireUser(request, env, origin);
      if (!auth.ok) return auth.response;
      return routeUserRequest(request, env, origin, url.pathname, auth.payload.sub);
    }

    return errorResponse(404, 'NOT_FOUND', 'Endpoint not found', origin);
  },
} satisfies ExportedHandler<Env>;
