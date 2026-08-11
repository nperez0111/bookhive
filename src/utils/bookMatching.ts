/**
 * Fuzzy book matching helpers used as a fallback when exact identifier
 * lookups (ISBN, Goodreads ID, OpenLibrary work ID) miss.
 *
 * Ported from the MIT-licensed shelfcheck project
 * (`nowells/libby-reading-list` — `app/lib/libby.ts` and `app/lib/dedupe.ts`)
 * with light adaptation for BookHive (tab-separated authors, HiveId).
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

/** Lowercase, strip non-alphanumerics, collapse whitespace. */
export function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase + strip every non-alphanumeric, used for fuzzy equivalence keys. */
export function normalizeCompact(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
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
 * "Children of Ruin", which would otherwise share a high Dice score from
 * the series stem.
 */
export function contentWordsMatch(searchTitle: string, candidateTitle: string): boolean {
  const searchContent = contentWords(searchTitle);
  if (searchContent.length === 0) return true;
  const candidateContent = new Set(contentWords(candidateTitle));
  return searchContent.every((w) => candidateContent.has(w));
}

/**
 * "Same work" key. When both books have an OpenLibrary `workId` this is
 * the most accurate equivalence; otherwise we fall back to a
 * compact-normalized title+author hash so punctuation/case variants —
 * "F. Scott Fitzgerald" vs "F Scott Fitzgerald" — collapse together.
 */
export function bookEquivalenceKey(book: {
  title: string;
  author: string;
  olWorkId?: string | null;
}): string {
  if (book.olWorkId) return `work:${book.olWorkId.toUpperCase()}`;
  return `fuzzy:${normalizeCompact(book.title)}\0${normalizeCompact(book.author)}`;
}
