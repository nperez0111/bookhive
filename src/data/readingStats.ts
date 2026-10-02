import type { Book } from "../types";
import { BOOK_STATUS } from "../constants";
import { sql } from "kysely";
import type { Database } from "../db";
import { normalizeBookMeta } from "../core/bookMeta";
import { STARS_PER_DISPLAY_STAR as STARS_TO_FIVE } from "../core/rating";

export type RatingBucket = 1 | 2 | 3 | 4 | 5;

export type ReadingStats = {
  booksCount: number;
  pagesRead: number;
  averageRating: number | null;
  ratingDistribution: Record<RatingBucket, number>;
  topGenres: { genre: string; count: number }[];
  shortestBook: Book | null;
  longestBook: Book | null;
  averagePageCount: number | null;
  mostPopularBook: Book | null;
  leastPopularBook: Book | null;
  /** First book finished in the year (earliest finishedAt) */
  firstBookOfYear: Book | null;
  /** Last book finished in the year (latest finishedAt) */
  lastBookOfYear: Book | null;
};

/**
 * How many pages a book has: the user's own `totalPages` when recorded, else
 * the catalogue's `numPages`, else unknown. Goes through `normalizeBookMeta`
 * because `hive_book.meta` is scraped and `numPages` can arrive as a string,
 * which a bare `> 0` guard would let through un-coerced.
 */
export function getPageCount(book: Pick<Book, "bookProgress" | "meta">): number | null {
  const fromProgress = book.bookProgress?.totalPages;
  if (fromProgress != null && fromProgress > 0) return fromProgress;
  return normalizeBookMeta(book.meta).numPages ?? null;
}

function starToFive(stars: number): RatingBucket {
  const five = Math.round(stars / STARS_TO_FIVE);
  return Math.min(5, Math.max(1, five)) as RatingBucket;
}

/**
 * Compute reading stats from a list of books, optionally filtered by year.
 * Caller should pass only finished books for the chosen scope (year or all-time)
 * and pre-aggregated genre counts for that same set (e.g. from hive_book_genre query).
 */
export function computeReadingStats(
  books: Book[],
  genreStats: { genre: string; count: number }[],
): ReadingStats {
  const finished = books.length > 0 ? books.filter((b) => b.status === BOOK_STATUS.FINISHED) : [];

  const booksCount = finished.length;

  let pagesRead = 0;
  const booksWithPages: Book[] = [];
  for (const b of finished) {
    const p = getPageCount(b);
    if (p != null) {
      pagesRead += p;
      booksWithPages.push(b);
    }
  }

  const withRating = finished.filter((b): b is Book & { stars: number } =>
    b.stars != null ? true : false,
  );
  const averageRating =
    withRating.length > 0
      ? withRating.reduce((s, b) => s + b.stars, 0) / withRating.length / STARS_TO_FIVE
      : null;

  const ratingDistribution: Record<RatingBucket, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  for (const b of withRating) {
    const bucket = starToFive(b.stars);
    ratingDistribution[bucket]++;
  }

  const topGenres = genreStats.slice(0, 15);

  let shortestBook: Book | null = null;
  let longestBook: Book | null = null;
  let shortestPages = Infinity;
  let longestPages = -1;
  for (const b of booksWithPages) {
    const p = getPageCount(b)!;
    if (p < shortestPages) {
      shortestPages = p;
      shortestBook = b;
    }
    if (p > longestPages) {
      longestPages = p;
      longestBook = b;
    }
  }
  const averagePageCount =
    booksWithPages.length > 0 ? Math.round(pagesRead / booksWithPages.length) : null;

  let mostPopularBook: Book | null = null;
  let leastPopularBook: Book | null = null;
  let bestScore = -Infinity;
  let worstScore = Infinity;
  for (const b of finished) {
    if (b.rating == null && (b.ratingsCount == null || b.ratingsCount <= 0)) continue;
    const rating = b.rating ?? 0;
    const count = b.ratingsCount ?? 0;
    // Compare by rating first, then ratingsCount as tiebreaker.
    const score = rating * 1e9 + count;
    if (score > bestScore) {
      bestScore = score;
      mostPopularBook = b;
    }
    if (score < worstScore) {
      worstScore = score;
      leastPopularBook = b;
    }
  }

  let firstBookOfYear: Book | null = null;
  let lastBookOfYear: Book | null = null;
  let earliestTs = Infinity;
  let latestTs = -Infinity;
  for (const b of finished) {
    if (b.finishedAt == null) continue;
    const ts = new Date(b.finishedAt).getTime();
    if (ts < earliestTs) {
      earliestTs = ts;
      firstBookOfYear = b;
    }
    if (ts > latestTs) {
      latestTs = ts;
      lastBookOfYear = b;
    }
  }

  return {
    booksCount,
    pagesRead,
    averageRating,
    ratingDistribution,
    topGenres,
    shortestBook,
    longestBook,
    averagePageCount,
    mostPopularBook,
    leastPopularBook,
    firstBookOfYear,
    lastBookOfYear,
  };
}

export function filterFinishedBooksByYear(books: Book[], year: number): Book[] {
  return books.filter(
    (b) =>
      b.status === BOOK_STATUS.FINISHED &&
      b.finishedAt != null &&
      new Date(b.finishedAt).getFullYear() === year,
  );
}

export function filterFinishedBooksAllTime(books: Book[]): Book[] {
  return books.filter((b) => b.status === BOOK_STATUS.FINISHED);
}

/** Minimum finished books in a year to show full Year in Books (Goodreads-style). */
export const MIN_BOOKS_FOR_YEAR_STATS = 3;

/** A stats year has to be a plausible calendar year, not any integer. */
export const MIN_STATS_YEAR = 2000;
export const MAX_STATS_YEAR = 2100;

export function isValidStatsYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_STATS_YEAR && year <= MAX_STATS_YEAR;
}

/** How many genres a stats surface shows. */
const GENRE_LIMIT = 15;

async function genreCountsFor(
  db: Database,
  books: Book[],
  limit: number,
): Promise<{ genre: string; count: number }[]> {
  const hiveIds = books.map((b) => b.hiveId);
  if (hiveIds.length === 0) return [];
  const rows = await db
    .selectFrom("hive_book_genre")
    .select(["genre", sql<number>`COUNT(*)`.as("count")])
    .where("hiveId", "in", hiveIds)
    .groupBy("genre")
    .orderBy(sql`COUNT(*)`, "desc")
    .orderBy("genre", "asc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({ genre: r.genre, count: Number(r.count) }));
}

export type ReadingStatsForYear = {
  stats: ReadingStats;
  /** Present only when the year was too light and we fell back. */
  allTimeStats?: ReadingStats;
  /** False when the year had fewer than `MIN_BOOKS_FOR_YEAR_STATS` finished books. */
  showYearInBooks: boolean;
  availableYears: number[];
};

/**
 * **The one** "reading stats for this user and year", including the fallback
 * rule: a year with fewer than `MIN_BOOKS_FOR_YEAR_STATS` finished books shows
 * all-time numbers instead. Three surfaces (web, OG card, XRPC) used to derive
 * this separately and disagreed on the fallback.
 */
export async function getReadingStatsForYear({
  db,
  books,
  year,
  genreLimit = GENRE_LIMIT,
}: {
  db: Database;
  /** The user's hydrated `user_book` rows. */
  books: Book[];
  year: number;
  genreLimit?: number;
}): Promise<ReadingStatsForYear> {
  const finishedInYear = filterFinishedBooksByYear(books, year);
  const showYearInBooks = finishedInYear.length >= MIN_BOOKS_FOR_YEAR_STATS;

  const stats = computeReadingStats(
    finishedInYear,
    await genreCountsFor(db, finishedInYear, genreLimit),
  );

  let allTimeStats: ReadingStats | undefined;
  const finishedAllTime = filterFinishedBooksAllTime(books);
  if (!showYearInBooks) {
    allTimeStats = computeReadingStats(
      finishedAllTime,
      await genreCountsFor(db, finishedAllTime, genreLimit),
    );
  }

  // Always offer the current year, so a user with no finished books still has somewhere to land.
  const years = new Set(
    finishedAllTime
      .map((b) => (b.finishedAt ? new Date(b.finishedAt).getFullYear() : 0))
      .filter(isValidStatsYear),
  );
  years.add(new Date().getFullYear());

  return {
    stats,
    ...(allTimeStats ? { allTimeStats } : {}),
    showYearInBooks,
    availableYears: [...years].sort((a, b) => b - a),
  };
}
