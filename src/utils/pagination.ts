export function parsePagination(url: URL): { page: number; size: number; offset: number } {
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const size = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('size') ?? '20', 10) || 20));
  return { page, size, offset: (page - 1) * size };
}
