import { errorResponse } from './response';
import { verifyAccessToken, type JwtPayload } from './jwt';

export type AuthResult = { ok: true; payload: JwtPayload } | { ok: false; response: Response };

function tokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get('Cookie')?.match(/access_token=([^;]+)/)?.[1];
  if (cookie) return cookie;
  const authorization = request.headers.get('Authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
}

export async function requireUser(request: Request, env: Env, origin: string): Promise<AuthResult> {
  const token = tokenFromRequest(request);
  if (!token) return { ok: false, response: errorResponse(401, 'UNAUTHORIZED', undefined, origin) };
  const result = await verifyAccessToken(token, env.JWT_PUBLIC_KEY_PEM);
  if (!result.valid || !result.payload || !result.payload.sub) {
    return { ok: false, response: errorResponse(401, 'UNAUTHORIZED', undefined, origin) };
  }
  return { ok: true, payload: result.payload };
}

export async function requireAdmin(request: Request, env: Env, origin: string): Promise<AuthResult> {
  const auth = await requireUser(request, env, origin);
  if (!auth.ok) return auth;
  if (auth.payload.role !== 'admin' && auth.payload.role !== 'super_admin') {
    return { ok: false, response: errorResponse(403, 'FORBIDDEN', 'Quyền truy cập chỉ dành cho Admin', origin) };
  }
  return auth;
}
