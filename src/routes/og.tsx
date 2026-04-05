/**
 * OG image generation routes.
 * Mount at /og.
 *
 * Route handlers run DB queries and build props on the main thread.
 * Rendering is offloaded to a dedicated worker thread via renderOgImage().
 * Results are cached in-memory with per-route TTLs via ocache.
 */
import { Hono } from "hono";
import { isDid } from "@atcute/lexicons/syntax";
import { defineCachedFunction } from "ocache";

import type { AppEnv } from "../context";
import { imageProcessingDuration, activeOperations, LABEL } from "../metrics";
import { BookFields } from "../db";
import type { Book, HiveId } from "../types";
import { getProfile } from "../utils/getProfile";
import { hydrateUserBook } from "../utils/bookProgress";
import {
  computeReadingStats,
  filterFinishedBooksByYear,
  filterFinishedBooksAllTime,
  MIN_BOOKS_FOR_YEAR_STATS,
} from "../utils/readingStats";
import { buildAuthorLikePatterns } from "../utils/authorMatching";
import { BOOK_STATUS } from "../constants";
import { sql } from "kysely";
import { renderOgImage } from "../workers/og-render/client";
import type { OgCard } from "../workers/og-render/types";

// ─── Cache + helpers ─────────────────────────────────────────────────────────

const cachedRenderOg = defineCachedFunction(
  async (card: OgCard) => {
    const buffer = await renderOgImage(card);
    return new Uint8Array(buffer);
  },
  {
    maxAge: 3600,
    getKey: (card) => `${card.kind}:${JSON.stringify(card.props)}`,
  },
);

// Cache TTLs in seconds
const TTL = {
  STATIC: 604800, // 7 days
  DAILY: 86400, // 1 day
  STATS: 21600, // 6 hours
  PROFILE: 3600, // 1 hour
} as const;

const getOrigin = (c: { req: { url: string } }) => new URL(c.req.url).origin;

async function makeOgResponse(card: OgCard, maxAge: number): Promise<Response> {
  const end = imageProcessingDuration.startTimer(LABEL.op.og_image);
  activeOperations.inc(LABEL.op.og_image);
  try {
    const bytes = await cachedRenderOg(card);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      },
    });
  } finally {
    end();
    activeOperations.dec(LABEL.op.og_image);
  }
}

const toCovers = (
  books: { cover: string | null; thumbnail: string | null }[],
  origin: string,
  width: number,
) =>
  books
    .map((b) => b.cover || b.thumbnail)
    .filter((url): url is string => Boolean(url))
    .map((url) => `${origin}/images/w_${width}/${url}`);

// ─── Routes ──────────────────────────────────────────────────────────────────

const app = new Hono<AppEnv>()
  .get("/marketing", (c) => {
    const origin = getOrigin(c);
    return makeOgResponse({ kind: "marketing", props: { origin } }, TTL.STATIC);
  })
  .get("/book/:hiveId", async (c) => {
    const hiveId = c.req.param("hiveId") as HiveId;
    const [book, readerRow] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .selectAll()
        .where("id", "=", hiveId)
        .limit(1)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("user_book")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("hiveId", "=", hiveId)
        .executeTakeFirst(),
    ]);

    if (!book) return c.notFound();

    const origin = getOrigin(c);
    const coverUrl =
      book.cover || book.thumbnail
        ? `${origin}/images/w_440/${book.cover || book.thumbnail}`
        : null;

    // Parse series JSON: {title, position}
    let seriesTitle: string | null = null;
    let seriesPosition: number | null = null;
    if (book.series) {
      try {
        const s = JSON.parse(book.series);
        seriesTitle = s.title || null;
        seriesPosition = s.position || null;
      } catch {}
    }

    // Parse meta JSON for publicationYear and numPages
    let publicationYear: number | null = null;
    let pageCount: number | null = null;
    if (book.meta) {
      try {
        const m = JSON.parse(book.meta);
        publicationYear = m.publicationYear || null;
        pageCount = m.numPages || null;
      } catch {}
    }

    return makeOgResponse(
      {
        kind: "book",
        props: {
          title: book.title,
          authors: book.authors.split("\t").filter(Boolean),
          coverUrl,
          rating: book.rating,
          ratingsCount: book.ratingsCount,
          seriesTitle,
          seriesPosition,
          publicationYear,
          pageCount,
          readerCount: Number(readerRow?.count ?? 0),
        },
      },
      TTL.STATIC,
    );
  })
  .get("/profile/:handle/stats/:year", async (c) => {
    const handle = c.req.param("handle");
    const year = parseInt(c.req.param("year"), 10);

    if (Number.isNaN(year) || year < 2000 || year > 2100) return c.notFound();

    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    if (!did) return c.notFound();

    const profile = await getProfile({ ctx: c.get("ctx"), did });

    const books = await c
      .get("ctx")
      .db.selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(BookFields)
      .where("user_book.userDid", "=", did)
      .orderBy("user_book.indexedAt", "desc")
      .limit(10_000)
      .execute();

    const parsedBooks = books.map((b) => hydrateUserBook(b));
    const finishedInYear = filterFinishedBooksByYear(parsedBooks, year);
    const useAllTime = finishedInYear.length < MIN_BOOKS_FOR_YEAR_STATS;
    const scope = useAllTime ? filterFinishedBooksAllTime(parsedBooks) : finishedInYear;

    const hiveIds = scope.map((b) => b.hiveId);
    let genreStats: { genre: string; count: number }[] = [];
    if (hiveIds.length > 0) {
      const rows = await c
        .get("ctx")
        .db.selectFrom("hive_book_genre")
        .select(["genre", sql<number>`COUNT(*)`.as("count")])
        .where("hiveId", "in", hiveIds)
        .groupBy("genre")
        .orderBy(sql`COUNT(*)`, "desc")
        .limit(5)
        .execute();
      genreStats = rows.map((r) => ({ genre: r.genre, count: Number(r.count) }));
    }

    const stats = computeReadingStats(scope, genreStats);
    const origin = getOrigin(c);
    const avatarUrl = profile?.avatar ? `${origin}/images/w_176/${profile.avatar}` : undefined;

    const booksPerMonth = stats.booksCount >= 2 ? stats.booksCount / 12 : null;

    const makeBookendCover = (book: Book | null) => {
      if (!book) return null;
      const img = book.cover || book.thumbnail;
      return {
        title: book.title,
        coverUrl: img ? `${origin}/images/w_120/${img}` : null,
      };
    };

    const longestBookData = stats.longestBook
      ? (() => {
          const pages = stats.longestBook!.bookProgress?.totalPages;
          return pages && pages > 0 ? { title: stats.longestBook!.title, pageCount: pages } : null;
        })()
      : null;

    return makeOgResponse(
      {
        kind: "stats",
        props: {
          handle,
          displayName: profile?.displayName,
          avatarUrl,
          year,
          booksCount: stats.booksCount,
          averageRating: stats.averageRating,
          topGenre: stats.topGenres[0]?.genre ?? null,
          pagesRead: stats.pagesRead,
          booksPerMonth,
          firstBook: makeBookendCover(stats.firstBookOfYear),
          lastBook: makeBookendCover(stats.lastBookOfYear),
          longestBook: longestBookData,
        },
      },
      TTL.STATS,
    );
  })
  .get("/profile/:handle", async (c) => {
    const handle = c.req.param("handle");
    const did = isDid(handle) ? handle : await c.get("ctx").baseIdResolver.handle.resolve(handle);
    if (!did) return c.notFound();

    const origin = getOrigin(c);
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01T00:00:00.000Z`;

    const [profile, totalRow, yearRow, currentlyReadingRow, recentBooks, genreRows] =
      await Promise.all([
        getProfile({ ctx: c.get("ctx"), did }),
        c
          .get("ctx")
          .db.selectFrom("user_book")
          .select((eb) => eb.fn.countAll().as("count"))
          .where("userDid", "=", did)
          .executeTakeFirst(),
        c
          .get("ctx")
          .db.selectFrom("user_book")
          .select((eb) => eb.fn.countAll().as("count"))
          .where("userDid", "=", did)
          .where("status", "=", BOOK_STATUS.FINISHED)
          .where("finishedAt", ">=", yearStart)
          .executeTakeFirst(),
        c
          .get("ctx")
          .db.selectFrom("user_book")
          .select(["title"])
          .where("userDid", "=", did)
          .where("status", "=", BOOK_STATUS.READING)
          .orderBy("indexedAt", "desc")
          .limit(1)
          .executeTakeFirst(),
        c
          .get("ctx")
          .db.selectFrom("user_book")
          .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
          .select(["hive_book.cover", "hive_book.thumbnail"])
          .where("user_book.userDid", "=", did)
          .orderBy("user_book.indexedAt", "desc")
          .limit(10)
          .execute(),
        c
          .get("ctx")
          .db.selectFrom("hive_book_genre")
          .innerJoin("user_book", "hive_book_genre.hiveId", "user_book.hiveId")
          .select(["hive_book_genre.genre", sql<number>`COUNT(*)`.as("count")])
          .where("user_book.userDid", "=", did)
          .groupBy("hive_book_genre.genre")
          .orderBy(sql`COUNT(*)`, "desc")
          .limit(5)
          .execute(),
      ]);

    return makeOgResponse(
      {
        kind: "profile",
        props: {
          handle,
          displayName: profile?.displayName,
          avatarUrl: profile?.avatar ? `${origin}/images/w_320/${profile.avatar}` : undefined,
          bio: profile?.description ?? null,
          totalBooks: Number(totalRow?.count ?? 0),
          booksThisYear: Number(yearRow?.count ?? 0),
          currentlyReading: currentlyReadingRow?.title ?? null,
          recentCovers: toCovers(recentBooks, origin, 260).slice(0, 6),
          topGenres: genreRows.map((r) => ({ genre: r.genre, count: Number(r.count) })),
        },
      },
      TTL.PROFILE,
    );
  })
  .get("/author/:author", async (c) => {
    const author = decodeURIComponent(c.req.param("author"));
    const origin = getOrigin(c);

    const patterns = buildAuthorLikePatterns(author);
    const authorCondition = sql`(
      authors = ${patterns.exact}
      OR authors LIKE ${patterns.first}
      OR authors LIKE ${patterns.middle}
      OR authors LIKE ${patterns.last}
    )`;

    const [totalRow, avgRow, books] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .select((eb) => eb.fn.countAll().as("count"))
        .where(authorCondition as any)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .select(sql<number>`AVG(rating)`.as("avg"))
        .where(authorCondition as any)
        .where("rating", "is not", null)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .select(["cover", "thumbnail"])
        .where(authorCondition as any)
        .orderBy("ratingsCount", "desc")
        .limit(6)
        .execute(),
    ]);

    return makeOgResponse(
      {
        kind: "labeled-cover",
        props: {
          label: "Author",
          name: author,
          totalBooks: Number(totalRow?.count ?? 0),
          covers: toCovers(books, origin, 260),
          avgRating: avgRow?.avg ?? null,
        },
      },
      TTL.DAILY,
    );
  })
  .get("/genre/:genre", async (c) => {
    const genre = decodeURIComponent(c.req.param("genre"));
    const origin = getOrigin(c);

    const [totalRow, readerRow, books] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("hive_book_genre")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("genre", "=", genre)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("user_book")
        .innerJoin("hive_book_genre", "user_book.hiveId", "hive_book_genre.hiveId")
        .select(sql<number>`COUNT(DISTINCT user_book.userDid)`.as("count"))
        .where("hive_book_genre.genre", "=", genre)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .innerJoin("hive_book_genre", "hive_book.id", "hive_book_genre.hiveId")
        .select(["hive_book.cover", "hive_book.thumbnail"])
        .where("hive_book_genre.genre", "=", genre)
        .orderBy("hive_book.ratingsCount", "desc")
        .limit(6)
        .execute(),
    ]);

    return makeOgResponse(
      {
        kind: "labeled-cover",
        props: {
          label: "Genre",
          name: genre,
          totalBooks: Number(totalRow?.count ?? 0),
          covers: toCovers(books, origin, 260),
          readerCount: Number(readerRow?.count ?? 0),
        },
      },
      TTL.DAILY,
    );
  })
  .get("/app", (c) => {
    const origin = getOrigin(c);
    return makeOgResponse({ kind: "app", props: { origin } }, TTL.STATIC);
  });

export default app;
