import { getMessage } from '../common/messages';
import { buildCorsHeaders } from './cors';

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: new Headers({ 'content-type': 'application/json', ...buildCorsHeaders(origin) }),
  });
}

export interface Pagination {
  page: number;
  size: number;
  total: number;
}

export function successResponse<T>(code: number, messageCode: string, data: T | undefined, origin: string, pagination?: Pagination): Response {
  return json({
    success: true,
    code,
    messageCode,
    message: getMessage(messageCode),
    ...(data !== undefined ? { data } : {}),
    ...(pagination !== undefined ? { pagination } : {}),
  }, code, origin);
}

export function errorResponse(code: number, messageCode: string, data: unknown, origin: string): Response {
  return json({ success: false, code, messageCode, message: getMessage(messageCode), ...(data !== undefined ? { data } : {}) }, code, origin);
}

export function corsResponse(origin: string): Response {
  return new Response(null, { headers: buildCorsHeaders(origin) });
}
