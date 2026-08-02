/**
 * Build an FTS5 MATCH expression from free-text user input.
 *
 * The whole input becomes a single **phrase** with a trailing `*`, i.e.
 * `"the girl"*`. That combination matters:
 *
 * - Phrase (quoted) keeps the words adjacent. Joining tokens with an implicit
 *   AND instead makes `the girl` match "The Diary of a Young Girl" ahead of
 *   "The Girl with the Dragon Tattoo", because ranking is by `ratingsCount`.
 *   With the phrase form the result set is identical to the `LIKE '%…%'` it
 *   replaces.
 * - The trailing `*` makes only the final token a prefix, so a half-typed
 *   query (`harry pot`, `lord of the ri`) still matches.
 *
 * Quotes inside the input are doubled, which is FTS5's escape — without it a
 * stray `"` is a syntax error and the query throws rather than returning
 * nothing. Everything else is inert inside a phrase, so no other escaping is
 * needed.
 *
 * Returns null when there is nothing indexable to match, in which case callers
 * should skip the FTS lookup entirely rather than run an empty MATCH.
 */
export function ftsMatchQuery(input: string): string | null {
  // Collapse internal whitespace runs and trim the ends. Punctuation is left
  // alone here — FTS5's tokenizer drops separator characters itself, and the
  // all-separators case is handled below.
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  // A phrase of only separator characters (punctuation, symbols) tokenizes to
  // nothing and matches everything; treat it as no query at all.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;

  return `"${cleaned.replace(/"/g, '""')}"*`;
}

/**
 * Very short queries are prefix-matched against nearly the whole corpus, which
 * costs about as much as the full scan it replaces (measured: `"a"*` 478ms vs
 * LIKE's 632ms) while returning arbitrary results. Callers use this to skip the
 * local backfill and rely on the upstream search instead.
 */
export const MIN_FTS_QUERY_LENGTH = 2;

export function isUsefulFtsQuery(input: string): boolean {
  return input.trim().length >= MIN_FTS_QUERY_LENGTH;
}
