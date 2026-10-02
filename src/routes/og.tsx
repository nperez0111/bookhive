/**
 * OG image generation routes.
 * Mount at /og.
 *
 * Route handlers run DB queries and build props on the main thread.
 * Rendering is offloaded to a dedicated worker thread via renderOgImage().
 * There is **no server-side cache** — see the note above `renderOnce` below.
 */
import { resolveActorDid } from "../services/actor";
import { Hono } from "hono";

import type { AppEnv } from "../context";
import type { Context } from "hono";
import { imageProcessingDuration, activeOperations, LABEL } from "../metrics";
import { BookFields } from "../db";
import type { Book, HiveId } from "../types";
import { getProfile } from "../services/getProfile";
import {
  getAuthorCardStats,
  getBookCardStats,
  getGenreCardStats,
  getProfileCardStats,
} from "../data/socialCards";
import { hydrateUserBook } from "../core/bookProgress";
import { getReadingStatsForYear, isValidStatsYear } from "../data/readingStats";
import { parseAuthors } from "../core/authors";
import { normalizeBookMeta } from "../core/bookMeta";
import { renderOgImage } from "../workers/og-render/client";
import type { OgCard } from "../workers/og-render/types";

// ─── Cache + helpers ─────────────────────────────────────────────────────────

/**
 * Renders are **not cached server-side** — Cloudflare is the cache, since the
 * origin sees an almost perfectly unique request stream and a server-side
 * cache isn't worth its cost (an unbounded `Map` OOM'd once; a KV table cost
 * a base64 round-trip and a sweep for little hit rate).
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

// Static branded card served when a render fails. Never 500 an OG endpoint:
// Bluesky/Discord/Slack cache a failed preview, so one bad render can break a
// book's link previews indefinitely.
const FALLBACK_FILENAME = "og-fallback.png";
// Only ever holds a successful read, so a file that shows up later still gets picked up.
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
    } catch {}
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
    // No `error` field here: the bag takes precedence over requestError in the
    // wide-event serializer, which would otherwise lose the type and stack.
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
    const [book, { readerCount }] = await Promise.all([
      c
        .get("ctx")
        .db.selectFrom("hive_book")
        .selectAll()
        .where("id", "=", hiveId)
        .limit(1)
        .executeTakeFirst(),
      getBookCardStats({ db: c.get("ctx").db, hiveId }),
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

    // `hive_book.meta` is scraped JSON; `normalizeBookMeta` is the one reader
    // that coerces and validates it.
    const meta = normalizeBookMeta(book.meta);
    const publicationYear = meta.publicationYear ?? null;
    const pageCount = meta.numPages ?? null;

    return makeOgResponse(
      c,
      {
        kind: "book",
        props: {
          title: book.title,
          authors: parseAuthors(book.authors),
          coverUrl,
          rating: book.rating,
          ratingsCount: book.ratingsCount,
          seriesTitle,
          seriesPosition,
          publicationYear,
          pageCount,
          readerCount,
        },
      },
      TTL.STATIC,
    );
  })
  .get("/profile/:handle/stats/:year", async (c) => {
    const handle = c.req.param("handle");
    const year = parseInt(c.req.param("year"), 10);

    if (!isValidStatsYear(year)) return c.notFound();

    const did = await resolveActorDid(c.get("ctx"), handle);
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
    // Shows the same scope the page shows (year, or all-time fallback);
    // `genreLimit` is 5 here vs. the page's 15, the only thing this surface changes.
    const { stats, allTimeStats } = await getReadingStatsForYear({
      db: c.get("ctx").db,
      books: parsedBooks,
      year,
      genreLimit: 5,
    });
    const shown = allTimeStats ?? stats;
    const origin = getOrigin(c);
    const avatarUrl = profile?.avatar ? `${origin}/images/w_176/${profile.avatar}` : undefined;

    const booksPerMonth = shown.booksCount >= 2 ? shown.booksCount / 12 : null;

    const makeBookendCover = (book: Book | null) => {
      if (!book) return null;
      const img = book.cover || book.thumbnail;
      return {
        title: book.title,
        coverUrl: img ? `${origin}/images/w_120/${img}` : null,
      };
    };

    const longestBookData = shown.longestBook
      ? (() => {
          const pages = shown.longestBook!.bookProgress?.totalPages;
          return pages && pages > 0 ? { title: shown.longestBook!.title, pageCount: pages } : null;
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
          booksCount: shown.booksCount,
          averageRating: shown.averageRating,
          topGenre: shown.topGenres[0]?.genre ?? null,
          pagesRead: shown.pagesRead,
          booksPerMonth,
          firstBook: makeBookendCover(shown.firstBookOfYear),
          lastBook: makeBookendCover(shown.lastBookOfYear),
          longestBook: longestBookData,
        },
      },
      TTL.STATS,
    );
  })
  .get("/profile/:handle", async (c) => {
    const handle = c.req.param("handle");
    const did = await resolveActorDid(c.get("ctx"), handle);
    if (!did) return c.notFound();

    const origin = getOrigin(c);

    const [profile, cardStats] = await Promise.all([
      getProfile({ ctx: c.get("ctx"), did }),
      getProfileCardStats({ db: c.get("ctx").db, did }),
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
          totalBooks: cardStats.totalBooks,
          booksThisYear: cardStats.booksThisYear,
          currentlyReading: cardStats.currentlyReading,
          recentCovers: toCovers(cardStats.covers, origin, 260).slice(0, 6),
          topGenres: cardStats.genres,
        },
      },
      TTL.PROFILE,
    );
  })
  .get("/author/:author", async (c) => {
    const author = decodeURIComponent(c.req.param("author"));
    const origin = getOrigin(c);

    const { totalBooks, avgRating, covers } = await getAuthorCardStats({
      db: c.get("ctx").db,
      author,
    });

    return makeOgResponse(
      c,
      {
        kind: "labeled-cover",
        props: {
          label: "Author",
          name: author,
          totalBooks,
          covers: toCovers(covers, origin, 260),
          avgRating,
        },
      },
      TTL.DAILY,
    );
  })
  .get("/genre/:genre", async (c) => {
    const genre = decodeURIComponent(c.req.param("genre"));
    const origin = getOrigin(c);

    const genreStats = await getGenreCardStats({ db: c.get("ctx").db, genre });

    return makeOgResponse(
      c,
      {
        kind: "labeled-cover",
        props: {
          label: "Genre",
          name: genre,
          totalBooks: genreStats.totalBooks,
          covers: toCovers(genreStats.covers, origin, 260),
          readerCount: genreStats.readerCount,
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
