import { sql } from "kysely";
import { z } from "zod";
import { isValid, parseISO } from "date-fns";

import type { AppContext } from "../context";
import { BookFields } from "../db";
import { BOOK_STATUS_FEED_VERB_MAP } from "../constants";
import type { Book, ProfileViewDetailed } from "../types";
import { hydrateUserBook } from "../core/bookProgress";
import { getProfiles } from "../services/getProfile";

/**
 * The one implementation of the activity feed — `GET /feed` and XRPC
 * `getFeed` are thin adapters over this, since the two used to be
 * independently-drifted copies.
 *
 * Errors are a discriminated result, never a throw — each adapter owns its
 * own failure shape (redirect vs `AuthRequiredError`).
 */

export const FEED_TABS = ["friends", "all", "tracking"] as const;
export type FeedTab = (typeof FEED_TABS)[number];

/** Tab copy lives next to `FEED_TABS` so the enum and the labels cannot drift. */
export const TAB_LABELS: Record<FeedTab, string> = {
  friends: "Friends",
  all: "All",
  tracking: "Books I Track",
};

export const TAB_EMPTY: Record<FeedTab, string> = {
  friends: "Follow users to see their activity",
  all: "Check back later",
  tracking: "Add books to your library to see activity on books you track",
};

/**
 * `.catch()` rather than a bare `z.enum()`: a hard 400 on a hand-edited or
 * truncated URL is hostile for a navigational GET, where "show me the default
 * feed" is an obviously correct fallback.
 */
export const feedQuerySchema = z.object({
  tab: z.enum(FEED_TABS).catch("friends"),
  cursor: z.string().max(512).optional().catch(undefined),
});

export const DEFAULT_FEED_LIMIT = 25;
export const MAX_FEED_LIMIT = 50;

/** Raw rows fetched per requested display row, so bursts have room to close. */
const RAW_OVERFETCH = 4;
/** Hard ceiling on one query's row count, whatever `limit` asks for. */
const RAW_MAX = 250;
/** A library sync or CSV import lands well inside this. */
const BURST_WINDOW_MS = 5 * 60_000;
/** Two books is not a burst, it's a Tuesday. */
const BURST_MIN = 3;

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/**
 * base64url of `${ts}\0${uri}` — the exact keyset tuple, nothing derived.
 *
 * Not signed, deliberately: the cursor grants no authority, since the tab
 * predicate is re-applied server-side from the session on every request.
 */
export function encodeFeedCursor(ts: string, uri: string): string {
  return Buffer.from(`${ts}\u0000${uri}`, "utf8").toString("base64url");
}

/**
 * Returns null — never throws — on anything malformed. A tampered, truncated or
 * stale cursor must render page 1 rather than a 500.
 */
export function decodeFeedCursor(raw: string | undefined | null): {
  ts: string;
  uri: string;
} | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.indexOf("\u0000");
    if (sep <= 0) return null;
    const ts = decoded.slice(0, sep);
    const uri = decoded.slice(sep + 1);
    if (!ts || !uri || uri.length > 512) return null;
    if (!isValid(parseISO(ts))) return null;
    if (!uri.startsWith("at://")) return null;
    return { ts, uri };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type FeedItem = {
  uri: string;
  /** The activity time. This is both the sort key and what the UI displays. */
  ts: string;
  actorDid: string;
  verb: string;
  book: Book;
};

export type FeedGroup =
  | { kind: "single"; item: FeedItem }
  | {
      kind: "burst";
      actorDid: string;
      /** The newest activity time in the burst — the group's feed position. */
      ts: string;
      verb: string;
      total: number;
      /** True when the burst was force-closed and `total` is a floor, not exact. */
      truncated: boolean;
      items: FeedItem[];
    };

/**
 * The slice of context the feed needs, structural rather than nominal so both
 * the Hono `AppContext` and the narrower `XrpcContext` satisfy it without a cast.
 */
export type FeedCtx = {
  db: AppContext["db"];
  kv: AppContext["kv"];
  getSessionAgent: AppContext["getSessionAgent"];
  resolver: { resolveDidsToHandles: (dids: string[]) => Promise<Record<string, string>> };
};

export type FeedResult =
  | {
      ok: true;
      groups: FeedGroup[];
      nextCursor: string | null;
      profileByDid: Record<string, ProfileViewDetailed>;
      didHandleMap: Record<string, string>;
    }
  | { ok: false; reason: "auth_required" };

/**
 * `BOOK_STATUS_PAST_TENSE_MAP` is phrased for a card where the book is implicit
 * ("has read this book") and reads redundantly in a timeline row that already
 * names the title, hence the separate verb map in `src/constants.ts`.
 */
export function feedVerbFor(book: Pick<Book, "status" | "review">): string {
  if (book.status && book.status in BOOK_STATUS_FEED_VERB_MAP) {
    return BOOK_STATUS_FEED_VERB_MAP[book.status as keyof typeof BOOK_STATUS_FEED_VERB_MAP];
  }
  if (book.review) return "reviewed";
  return "added";
}

/**
 * Label for a collapsed burst. Bursts group by actor alone, not by (actor,
 * verb) — a re-sync interleaves "finished" and "wants to read" row by row, so
 * a verb-sensitive key would break the run apart. All-one-verb says so; mixed
 * says "logged".
 */
function burstVerbFor(items: FeedItem[]): string {
  const first = items[0]?.verb;
  return items.every((i) => i.verb === first) && first ? first : "logged";
}

/**
 * Reviews are `line-clamp-2`'d in the UI, but that only hides them visually — a
 * 20 KB review would still ship over the wire, times `limit`. Truncate here.
 */
const REVIEW_EXCERPT_CHARS = 240;

function excerpt(review: string | null): string | null {
  if (!review) return null;
  const trimmed = review.trim();
  if (!trimmed) return null;
  return trimmed.length > REVIEW_EXCERPT_CHARS
    ? `${trimmed.slice(0, REVIEW_EXCERPT_CHARS).trimEnd()}…`
    : trimmed;
}

// ---------------------------------------------------------------------------
// Burst collapsing
// ---------------------------------------------------------------------------

/**
 * Collapse a run of consecutive same-actor activity into one group.
 *
 * - Grouped by actor alone, not by (actor, verb) — see `burstVerbFor`.
 * - Done in JS after the fetch, not in SQL: knowing where a group *ends*
 *   means reading past the page boundary, which would defeat the `LIMIT`
 *   the keyset scan depends on.
 * - Returns the groups plus the index of the last raw row consumed. The
 *   caller must derive the next cursor from that row, never from the last
 *   display row, or a collapsed burst re-serves itself forever.
 * - A trailing group still open when rows run out is discarded and
 *   reappears whole on the next page — unless discarding would leave the
 *   page empty, in which case it's force-closed and marked `truncated`.
 */
export function collapseBursts(
  items: FeedItem[],
  limit: number,
  { hasMoreRaw }: { hasMoreRaw: boolean },
): { groups: FeedGroup[]; consumed: number } {
  const groups: FeedGroup[] = [];
  let i = 0;
  let consumed = 0;

  while (i < items.length && groups.length < limit) {
    const first = items[i]!;
    const windowFloor = new Date(first.ts).getTime() - BURST_WINDOW_MS;

    let j = i + 1;
    while (j < items.length) {
      const next = items[j]!;
      if (next.actorDid !== first.actorDid) break;
      if (new Date(next.ts).getTime() < windowFloor) break;
      j++;
    }

    const run = items.slice(i, j);
    // The run touches the end of the fetched rows and there may be more of it
    // beyond the page boundary, so we cannot know its true size yet.
    const runIsOpen = j === items.length && hasMoreRaw;

    if (runIsOpen && run.length < BURST_MIN && groups.length > 0) {
      // Too short to summarise honestly, and splitting it would scatter one
      // person's run across a page boundary as unrelated singles — leave it
      // whole for the next page. A run that IS long enough instead falls
      // through and is emitted as a truncated burst, so the page still fills.
      break;
    }

    if (run.length >= BURST_MIN) {
      groups.push({
        kind: "burst",
        actorDid: first.actorDid,
        ts: first.ts,
        verb: burstVerbFor(run),
        total: run.length,
        truncated: runIsOpen,
        items: run,
      });
      consumed = j;
    } else {
      for (const item of run) {
        if (groups.length >= limit) break;
        groups.push({ kind: "single", item });
        consumed += 1;
      }
    }
    i = j;
  }

  return { groups, consumed };
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * Ordered `indexedAt DESC, uri DESC` with keyset pagination.
 *
 * `indexedAt`, not `createdAt`: `createdAt` mirrors a frozen PDS record field
 * and never moves on activity, which is the bug migration 027 fixes.
 *
 * `uri` is a load-bearing tiebreaker — many rows can share a timestamp, and
 * SQLite may order ties differently between two identical requests, silently
 * dropping rows from a paginated feed.
 *
 * `(a, b) < (?, ?)` is SQLite's row-value comparison, which it drives
 * straight off a `(a, b)` index; the expanded `a < ? OR (a = ? AND b < ?)`
 * form usually plans worse. `src/data/activityFeed.test.ts` asserts the
 * plans rather than trusting them.
 *
 * The IN-driven `friends`/`tracking` tabs do indexed per-key lookups plus a
 * temp B-tree over the matches — inherent, since rows for many DIDs
 * interleave and no index can hand back the order directly. If that ever
 * gets too slow, bound it by `indexedAt >= cursorTs - window` with a
 * widening retry rather than reaching for something cleverer.
 */
export function buildFeedQuery({
  ctx,
  viewerDid,
  tab,
  cursor,
  rawLimit,
}: {
  ctx: Pick<FeedCtx, "db">;
  viewerDid: string | null;
  tab: FeedTab;
  cursor: { ts: string; uri: string } | null;
  rawLimit: number;
}) {
  let query = ctx.db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .orderBy("user_book.indexedAt", "desc")
    .orderBy("user_book.uri", "desc")
    .limit(rawLimit + 1);

  if (cursor) {
    query = query.where(
      sql<boolean>`(user_book.indexedAt, user_book.uri) < (${cursor.ts}, ${cursor.uri})`,
    ) as typeof query;
  }

  if (tab === "friends" && viewerDid) {
    query = query.where(
      "user_book.userDid",
      "in",
      ctx.db
        .selectFrom("user_follows")
        .where("user_follows.userDid", "=", viewerDid)
        .where("user_follows.isActive", "=", 1)
        .select("user_follows.followsDid"),
    ) as typeof query;
  } else if (tab === "tracking" && viewerDid) {
    query = query.where(
      "user_book.hiveId",
      "in",
      ctx.db
        .selectFrom("user_book as ub2")
        .where("ub2.userDid", "=", viewerDid)
        .select("ub2.hiveId"),
    ) as typeof query;
  }

  return query;
}

function fetchFeedRows(args: Parameters<typeof buildFeedQuery>[0]) {
  return buildFeedQuery(args).execute();
}

export async function getActivityFeed({
  ctx,
  viewerDid,
  tab,
  limit = DEFAULT_FEED_LIMIT,
  cursor: rawCursor,
  collapse = true,
}: {
  ctx: FeedCtx;
  viewerDid: string | null;
  tab: FeedTab;
  limit?: number;
  cursor?: string;
  /** iOS builds predating the group shape can opt out and get flat items. */
  collapse?: boolean;
}): Promise<FeedResult> {
  if ((tab === "friends" || tab === "tracking") && !viewerDid) {
    return { ok: false, reason: "auth_required" };
  }

  const pageSize = Math.min(MAX_FEED_LIMIT, Math.max(1, limit));
  const cursor = decodeFeedCursor(rawCursor);
  const rawLimit = collapse ? Math.min(RAW_MAX, pageSize * RAW_OVERFETCH) : pageSize;

  const rows = await fetchFeedRows({ ctx, viewerDid, tab, cursor, rawLimit });
  const hasMoreRaw = rows.length > rawLimit;
  const raw = rows.slice(0, rawLimit);

  const items: FeedItem[] = raw.map((row) => {
    const book = hydrateUserBook(row) as Book;
    return {
      uri: book.uri,
      ts: book.indexedAt,
      actorDid: book.userDid,
      verb: feedVerbFor(book),
      book: { ...book, review: excerpt(book.review) },
    };
  });

  const { groups, consumed } = collapse
    ? collapseBursts(items, pageSize, { hasMoreRaw })
    : {
        groups: items.slice(0, pageSize).map((item) => ({ kind: "single" as const, item })),
        consumed: Math.min(items.length, pageSize),
      };

  // The cursor points at the last raw row consumed, never at the last display
  // row — a collapsed burst of 47 must advance past all 47.
  const lastConsumed = consumed > 0 ? items[consumed - 1] : undefined;
  const exhausted = !hasMoreRaw && consumed >= items.length;
  const nextCursor =
    lastConsumed && !exhausted ? encodeFeedCursor(lastConsumed.ts, lastConsumed.uri) : null;

  const allDids = [
    ...new Set(groups.flatMap((g) => (g.kind === "single" ? [g.item.actorDid] : [g.actorDid]))),
  ];
  const [didHandleMap, profiles] = await Promise.all([
    allDids.length > 0 ? ctx.resolver.resolveDidsToHandles(allDids) : Promise.resolve({}),
    allDids.length > 0 ? getProfiles({ ctx, dids: allDids }) : Promise.resolve([]),
  ]);

  return {
    ok: true,
    groups,
    nextCursor,
    didHandleMap,
    profileByDid: Object.fromEntries(profiles.map((p) => [p.did, p])),
  };
}
