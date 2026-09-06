export function getCorsOrigin(request: Request): { allowed: boolean; origin: string } {
  const origin = request.headers.get('Origin') ?? '';
  if (!origin) return { allowed: true, origin: '' };
  try {
    const url = new URL(origin);
    const isHocNhe = url.protocol === 'https:'
      && (url.hostname === 'hocnhe.com' || url.hostname.endsWith('.hocnhe.com'));
    const isLocal = (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return { allowed: isHocNhe || isLocal, origin: isHocNhe || isLocal ? origin : '' };
  } catch {
    return { allowed: false, origin: '' };
  }
}

export function buildCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': origin ? 'true' : 'false',
    Vary: 'Origin',
  };
}
