import { errorResponse } from './response';

export function parseOptionalMediaUrl(value: unknown, field: 'audio' | 'image', origin: string): string | null | undefined | Response {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    return errorResponse(400, 'VALIDATION_ERROR', `${field} phải là URL hợp lệ hoặc null`, origin);
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported protocol');
    return url.toString();
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', `${field} phải là URL HTTP(S) hợp lệ hoặc null`, origin);
  }
}
