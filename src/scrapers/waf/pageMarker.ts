/**
 * Marker that identifies a real Goodreads (Next.js) book page as opposed to an
 * AWS WAF challenge page. Shared between `moreInfo.ts` (which slices the JSON out
 * of it) and the WAF solver worker (which uses it to decide whether a fetched
 * page is the real thing or still a challenge).
 */
export const NEXT_DATA_MARKER = `__NEXT_DATA__" type="application/json">`;
