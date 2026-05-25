/**
 * Builds a URL string from a base path and a record of query parameters.
 * Filters out undefined, null, and empty-string values.
 */
export function buildUrl(
  base: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `${base}?${qs}` : base;
}
