/**
 * Fuzzy title/author scoring primitives, shared by anything that has to decide
 * whether two differently-written strings name the same book. Ported from the
 * MIT-licensed shelfcheck project (`nowells/libby-reading-list`).
 *
 * These normalize on the ASCII range: `normalizeForMatch` drops any character
 * outside `[a-z0-9\s]` rather than folding it, so callers with non-Latin input
 * must fold diacritics themselves first (`src/core/filenameMatching.ts` does).
 */

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "is",
  "it",
  "by",
  "as",
  "be",
  "no",
  "not",
  "but",
  "from",
  "with",
]);

/**
 * Lowercase, strip non-alphanumerics, collapse whitespace.
 *
 * Punctuation is *deleted*, not replaced with a space, so "hitchhiker's" and
 * "hitchhikers" collapse onto the same word instead of differing by a stray "s".
 */
export function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant words in `s` after stop-word removal. */
export function contentWords(s: string): string[] {
  return normalizeForMatch(s)
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/**
 * Sørensen–Dice on whitespace-separated words after normalization.
 * Returns 1 for an exact normalized match.
 */
export function similarityScore(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === nb) return 1;

  const wordsA = na.split(" ").filter(Boolean);
  const wordsB = nb.split(" ").filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setB = new Set(wordsB);
  const intersection = wordsA.filter((w) => setB.has(w));
  return (2 * intersection.length) / (wordsA.length + wordsB.length);
}

/**
 * All-content-words gate: every significant word in `searchTitle` must
 * appear in `candidateTitle`. Keeps "Children of Time" from accepting
 * "Children of Ruin" despite a high Dice score from the shared series stem.
 *
 * Containment is one-directional, so "Dune" passes against "Dune Messiah" —
 * gate in both directions anywhere a superset is the *wrong* book.
 */
export function contentWordsMatch(searchTitle: string, candidateTitle: string): boolean {
  const searchContent = contentWords(searchTitle);
  if (searchContent.length === 0) return true;
  const candidateContent = new Set(contentWords(candidateTitle));
  return searchContent.every((w) => candidateContent.has(w));
}
