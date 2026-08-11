/**
 * Resilient hive_book matcher used by the CSV importer when the strict
 * `rawTitle = ? AND authors = ?` lookup misses. Layers identifier-based
 * matching (ISBN-13 / Goodreads ID) on top of fuzzy title/author scoring
 * powered by `bookMatching.ts`.
 */
import type { Database } from "../db";
import type { HiveId } from "../types";
import { normalizeGoodreadsId, normalizeIsbn, normalizeIsbn13 } from "./bookIdentifiers";
import { contentWords, contentWordsMatch, similarityScore } from "./bookMatching";

const FUZZY_TITLE_THRESHOLD = 0.6;
const FUZZY_AUTHOR_THRESHOLD = 0.6;
const MAX_CANDIDATES = 50;

type HiveBookMatchRow = {
  id: HiveId;
  title: string;
  cover: string | null;
  identifiers: string | null;
};

export type HiveBookMatch = HiveBookMatchRow & { matchedBy: MatchSource };

export type MatchSource = "exact" | "isbn13" | "goodreadsId" | "fuzzy";

export type FindHiveBookMatchInput = {
  title: string;
  author: string;
  /** Either an ISBN-10 or ISBN-13. The matcher routes to the right column. */
  isbn?: string | null;
  isbn13?: string | null;
  goodreadsId?: string | null;
};

/**
 * Fast-path: identifier lookups via `book_id_map`. Only returns a hit when
 * we can confidently map the imported row to a single `hive_book.id`.
 */
async function findByIdentifier(
  db: Database,
  input: FindHiveBookMatchInput,
): Promise<{ row: HiveBookMatchRow; matchedBy: MatchSource } | null> {
  // Treat any 13-digit value (whether passed as `isbn13` or `isbn`) as
  // ISBN-13, and any 10-digit value as ISBN-10.
  const candidateIsbn13 = [input.isbn13, input.isbn]
    .map((v) => normalizeIsbn13(v))
    .find((v) => v && v.length === 13);
  if (candidateIsbn13) {
    const row = await db
      .selectFrom("hive_book")
      .innerJoin("book_id_map", "book_id_map.hiveId", "hive_book.id")
      .select(["hive_book.id", "hive_book.title", "hive_book.cover", "hive_book.identifiers"])
      .where("book_id_map.isbn13", "=", candidateIsbn13)
      .executeTakeFirst();
    if (row) return { row, matchedBy: "isbn13" };
  }

  const candidateIsbn10 = [input.isbn, input.isbn13]
    .map((v) => normalizeIsbn(v))
    .find((v) => v && v.length === 10);
  if (candidateIsbn10) {
    const row = await db
      .selectFrom("hive_book")
      .innerJoin("book_id_map", "book_id_map.hiveId", "hive_book.id")
      .select(["hive_book.id", "hive_book.title", "hive_book.cover", "hive_book.identifiers"])
      .where("book_id_map.isbn", "=", candidateIsbn10)
      .executeTakeFirst();
    if (row) return { row, matchedBy: "isbn13" };
  }

  const goodreadsId = normalizeGoodreadsId(input.goodreadsId);
  if (goodreadsId) {
    const row = await db
      .selectFrom("hive_book")
      .innerJoin("book_id_map", "book_id_map.hiveId", "hive_book.id")
      .select(["hive_book.id", "hive_book.title", "hive_book.cover", "hive_book.identifiers"])
      .where("book_id_map.goodreadsId", "=", goodreadsId)
      .executeTakeFirst();
    if (row) return { row, matchedBy: "goodreadsId" };
  }

  return null;
}

/**
 * Fuzzy fallback: pull candidate hive_book rows whose `rawTitle` shares
 * the imported title's first significant word, then locally rank by
 * `similarityScore` and gate with `contentWordsMatch` so series-mate
 * collisions don't slip through.
 */
async function findByFuzzy(
  db: Database,
  input: FindHiveBookMatchInput,
): Promise<HiveBookMatchRow | null> {
  const titleWords = contentWords(input.title);
  if (titleWords.length === 0) return null;
  const firstWord = titleWords[0]!;

  // The leading content word almost always survives editor edits ("The
  // Great Gatsby" / "Great Gatsby") so this prefix prefilter is cheap and
  // correct enough to avoid scanning the whole table.
  const candidates = await db
    .selectFrom("hive_book")
    .select(["id", "title", "rawTitle", "authors", "cover", "identifiers"])
    .where(
      // SQLite LIKE is case-insensitive for ASCII by default — matches
      // "The Great Gatsby", "the great gatsby", etc.
      (eb) =>
        eb.or([
          eb("hive_book.rawTitle", "like", `%${firstWord}%`),
          eb("hive_book.title", "like", `%${firstWord}%`),
        ]),
    )
    .limit(MAX_CANDIDATES)
    .execute();

  let best: { row: HiveBookMatchRow; score: number } | null = null;
  for (const candidate of candidates) {
    const titleScore = similarityScore(input.title, candidate.rawTitle ?? candidate.title);
    if (titleScore < FUZZY_TITLE_THRESHOLD) continue;
    if (!contentWordsMatch(input.title, candidate.rawTitle ?? candidate.title)) continue;

    // `authors` is tab-separated. Score against the best individual author.
    const authorList = (candidate.authors ?? "").split("\t").filter(Boolean);
    const authorScore = authorList.length
      ? Math.max(...authorList.map((a) => similarityScore(input.author, a)))
      : 0;
    if (authorScore < FUZZY_AUTHOR_THRESHOLD) continue;

    const combined = (titleScore + authorScore) / 2;
    if (!best || combined > best.score) {
      best = {
        score: combined,
        row: {
          id: candidate.id,
          title: candidate.title,
          cover: candidate.cover,
          identifiers: candidate.identifiers,
        },
      };
    }
  }

  return best?.row ?? null;
}

/**
 * Match an imported book row to a canonical `hive_book` record. Returns
 * `null` when no confident match is found.
 */
export async function findHiveBookMatch(
  db: Database,
  input: FindHiveBookMatchInput,
): Promise<HiveBookMatch | null> {
  // Phase 1: exact title/author. Mirrors the original importer query so
  // it stays the cheapest path when CSV titles match canonical ones.
  const exact = await db
    .selectFrom("hive_book")
    .select(["id", "title", "cover", "identifiers"])
    .where("hive_book.rawTitle", "=", input.title)
    .where("authors", "=", input.author)
    .executeTakeFirst();
  if (exact) return { ...exact, matchedBy: "exact" };

  // Phase 2: identifier lookups (book_id_map already deduped by hiveId).
  const byId = await findByIdentifier(db, input);
  if (byId) return { ...byId.row, matchedBy: byId.matchedBy };

  // Phase 3: fuzzy title/author fallback.
  const fuzzy = await findByFuzzy(db, input);
  if (fuzzy) return { ...fuzzy, matchedBy: "fuzzy" };

  return null;
}

export type { HiveId };
