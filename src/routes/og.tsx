/**
 * OG image generation routes.
 * Mount at /og.
 *
 * Route handlers run DB queries and build props on the main thread.
 * Rendering is offloaded to a dedicated worker thread via renderOgImage().
 * There is **no server-side cache** — see the note above `renderOnce` below.
 */
import { Hono } from "hono";
import { isDid } from "@atcute/lexicons/syntax";

import type { AppEnv } from "../context";
import type { Context } from "hono";
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
import { BOOK_STATUS } from "../constants";
import { sql } from "kysely";
import { renderOgImage } from "../workers/og-render/client";
import type { OgCard } from "../workers/og-render/types";

// ─── Cache + helpers ─────────────────────────────────────────────────────────

/**
 * Renders are **not cached server-side**. Cloudflare is the cache: these
 * responses carry `public, max-age=…`, and a card that gets requested twice is
 * served from the edge without touching the origin. Measured over 48h of
 * production traffic, the origin therefore sees an almost perfectly unique
 * stream — 1,189 requests across 1,134 distinct cards, 1,081 of them requested
 * exactly once, max 4 repeats. A *perfect* origin cache could have served 4% of
 * them.
 *
 * That 4% was previously bought with an unbounded per-process `Map` of webp
 * bytes (the OOM), and then with an `og_cache` KV table that cost a base64
 * round-trip, a sweep on the 15-min timer, two gauges, and an extra writer to a
 * file we already have to VACUUM. Rendering on demand costs ~600ms p50 on a
 * worker thread, ~25 times an hour.
 *
 * `renderOnce` is all that survives: concurrent requests for the *same* cold
 * card share one render instead of starting N. It holds promises, never bytes,
 * and always clears in `finally`.
 */
const inflight = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

function renderOnce(card: OgCard): Promise<Uint8Array<ArrayBuffer>> {
  const key = `${card.kind}:${Bun.hash(JSON.stringify(card.props)).toString(36)}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const work = renderOgImage(card).then((buf) => new Uint8Array(buf) as Uint8Array<ArrayBuffer>);
  inflight.set(key, work);
  return work.finally(() => {
    inflight.delete(key);
  });
}

// Cache TTLs in seconds
const TTL = {
  STATIC: 604800, // 7 days
  DAILY: 86400, // 1 day
  STATS: 21600, // 6 hours
  PROFILE: 3600, // 1 hour
} as const;

const getOrigin = (c: { req: { url: string } }) => new URL(c.req.url).origin;

/**
 * Static branded card served when a render fails. Never 500 an OG endpoint:
 * Bluesky/Discord/Slack cache a failed preview, so one bad render can break a
 * book's link previews indefinitely.
 */
const FALLBACK_FILENAME = "og-fallback.png";
/** Only ever holds a successful read — a miss is not memoized, so a file that
 *  shows up later (or a path that resolves differently) still gets picked up
 *  instead of pinning us to the redirect branch for the process's lifetime. */
let fallbackBytes: Uint8Array<ArrayBuffer> | null = null;

async function loadFallbackImage(): Promise<Uint8Array<ArrayBuffer> | null> {
  if (fallbackBytes) return fallbackBytes;
  // Nitro copies public/ to .output/public/; in dev it's read from the repo.
  const candidates = [
    new URL(`../public/${FALLBACK_FILENAME}`, import.meta.url).pathname,
    `${process.cwd()}/public/${FALLBACK_FILENAME}`,
    `${process.cwd()}/.output/public/${FALLBACK_FILENAME}`,
  ];
  for (const path of candidates) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        fallbackBytes = new Uint8Array(await file.arrayBuffer());
        return fallbackBytes;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function fallbackOgResponse(): Promise<Response> {
  const bytes = await loadFallbackImage();
  if (!bytes) {
    // Last resort: let the static handler serve it.
    return new Response(null, {
      status: 302,
      headers: { Location: `/${FALLBACK_FILENAME}`, "Cache-Control": "public, max-age=300" },
    });
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      // Short, so a transient render failure isn't cached for a week.
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function makeOgResponse(c: Context<AppEnv>, card: OgCard, maxAge: number): Promise<Response> {
  const end = imageProcessingDuration.startTimer(LABEL.op.og_image);
  activeOperations.inc(LABEL.op.og_image);
  try {
    const bytes = await renderOnce(card);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    // No `error` field here on purpose: the bag takes precedence over
    // requestError in the wide-event serializer, so setting a bare string would
    // throw away the type and stack it would otherwise record.
    c.set("requestError", error);
    c.get("ctx").addWideEventContext({
      og_render: "failed",
      og_card_kind: card.kind,
    });
    return fallbackOgResponse();
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
    return makeOgResponse(c, { kind: "marketing", props: { origin } }, TTL.STATIC);
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
      c,
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
      c,
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
      c,
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

    const [totalRow, avgRow, books] = await Promise.all([
      c
        .get("ctx")
        // Joined to hive_book like the two queries below it. Counting
        // hive_book_author alone would report a different total than the books
        // actually rendered if the mapping ever holds a row whose book is gone.
        .db.selectFrom("hive_book")
        .innerJoin("hive_book_author", "hive_book_author.hiveId", "hive_book.id")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("hive_book_author.author", "=", author)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .innerJoin("hive_book_author", "hive_book_author.hiveId", "hive_book.id")
        .select(sql<number>`AVG(rating)`.as("avg"))
        .where("hive_book_author.author", "=", author)
        .where("rating", "is not", null)
        .executeTakeFirst(),
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .innerJoin("hive_book_author", "hive_book_author.hiveId", "hive_book.id")
        .select(["cover", "thumbnail"])
        .where("hive_book_author.author", "=", author)
        .orderBy("ratingsCount", "desc")
        .limit(6)
        .execute(),
    ]);

    return makeOgResponse(
      c,
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
      c,
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
    return makeOgResponse(c, { kind: "app", props: { origin } }, TTL.STATIC);
  });

export default app;
