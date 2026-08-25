export function getOrigin(request: Request): string {
  return request.headers.get('Origin') ?? '';
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
