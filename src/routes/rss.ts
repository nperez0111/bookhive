/**
 * RSS feed routes for user and friends activity.
 * Mount at /rss so paths are /rss/user/:handle and /rss/friends/:handle.
 */
import { Hono } from "hono";
import { isDid } from "@atcute/lexicons/syntax";

import type { AppContext, AppEnv } from "../context";
import { BookFields } from "../db";
import { BOOK_STATUS } from "../constants";
import type { HiveId } from "../types";
import { escapeXml } from "../lib/xml";
import { displayAuthors, primaryAuthor } from "../core/authors";
import { MAX_DISPLAY_RATING, starsToDisplayRating } from "../core/rating";

const STATUS_SHORTHAND: Record<string, string> = {
  finished: BOOK_STATUS.FINISHED,
  reading: BOOK_STATUS.READING,
  wantToRead: BOOK_STATUS.WANTTOREAD,
  abandoned: BOOK_STATUS.ABANDONED,
};

function getActionText(status: string | null): string {
  if (!status) return "updated";
  if (status.includes("finished")) return "finished reading";
  if (status.includes("reading")) return "started reading";
  if (status.includes("abandoned")) return "abandoned";
  if (status.includes("wantToRead")) return "wants to read";
  return "updated";
}

function toRfc2822(iso: string): string {
  return new Date(iso).toUTCString();
}

function parseStatusFilter(param: string | undefined): string[] | null {
  if (!param) return null;
  const statuses = param
    .split(",")
    .map((s) => STATUS_SHORTHAND[s.trim()])
    .filter((s): s is string => Boolean(s));
  return statuses.length > 0 ? statuses : null;
}

type FeedItem = {
  uri: string;
  hiveId: string;
  title: string;
  authors: string;
  status: string | null;
  stars: number | null;
  review: string | null;
  createdAt: string;
  /** The activity time — what `pubDate` and the ordering both use. */
  indexedAt: string;
  userDid: string;
};

type ChannelMeta = {
  title: string;
  link: string;
  description: string;
};

// Ordered by, and dated with, `indexedAt` — the same activity time the site's feed uses;
// emitting `createdAt` as `pubDate` while ordering by `indexedAt` would reproduce the
// sorted-by-one-column-labelled-with-another bug, just in XML. Safe to re-date because
// `<guid isPermaLink="false">` is the AT URI and doesn't change, so readers dedupe on it.
/** The channel envelope, shared so each feed differs only in title/description. */
function rssFeed(channel: ChannelMeta, items: string[], latestIso: string | undefined): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <lastBuildDate>${toRfc2822(latestIso ?? new Date().toISOString())}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>`;
}

/** One `<item>`. `guid` is the AT URI, `pubDate` is `indexedAt` — see the note above. */
function rssItem(item: FeedItem, opts: { title: string; link: string; descHtml: string }): string {
  return `    <item>
      <title>${escapeXml(opts.title)}</title>
      <link>${escapeXml(opts.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.uri)}</guid>
      <pubDate>${toRfc2822(item.indexedAt)}</pubDate>
      <description><![CDATA[${opts.descHtml}]]></description>
    </item>`;
}

/** Rating and review lines, identical in all three feeds. */
function ratingAndReview(item: FeedItem): string {
  let html = "";
  const starDisplay = starsToDisplayRating(item.stars);
  if (starDisplay != null) {
    html += `<p>Rating: ${starDisplay} / ${MAX_DISPLAY_RATING}</p>`;
  }
  if (item.review) {
    html += `<p><em>${escapeXml(item.review)}</em></p>`;
  }
  return html;
}

/** The `?status=` and `?limit=` preamble, written out three times. */
function feedParams(c: { req: { query: (k: string) => string | undefined } }) {
  return {
    statusFilter: parseStatusFilter(c.req.query("status")),
    limit: Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "50", 10))),
  };
}

/**
 * The rows behind every RSS feed: `user_book` joined to `hive_book`, newest
 * activity first, with `uri` as the keyset tiebreaker — mirrors `buildFeedQuery`
 * in `src/data/activityFeed.ts`, differing only in `where`.
 */
async function activityRows(
  db: AppContext["db"],
  scope:
    | { kind: "user"; did: string }
    | { kind: "book"; hiveId: HiveId }
    | { kind: "friends"; did: string },
  { limit, statusFilter }: { limit: number; statusFilter: string[] | null },
): Promise<FeedItem[]> {
  let query = db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(BookFields)
    .orderBy("user_book.indexedAt", "desc")
    .orderBy("user_book.uri", "desc")
    .limit(limit);

  if (scope.kind === "user") {
    query = query.where("user_book.userDid", "=", scope.did) as typeof query;
  } else if (scope.kind === "book") {
    query = query.where("user_book.hiveId", "=", scope.hiveId) as typeof query;
  } else {
    query = query.where(
      "user_book.userDid",
      "in",
      db
        .selectFrom("user_follows")
        .where("user_follows.userDid", "=", scope.did)
        .where("user_follows.isActive", "=", 1)
        .select("user_follows.followsDid"),
    ) as typeof query;
  }

  if (statusFilter) {
    query = query.where("user_book.status", "in", statusFilter) as typeof query;
  }

  return await query.execute();
}

const RSS_HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
} as const;

const app = new Hono<AppEnv>()
  .get("/user/:handle", async (c) => {
    const ctx = c.get("ctx");
    const handleParam = c.req.param("handle");

    const did = isDid(handleParam)
      ? handleParam
      : await ctx.baseIdResolver.handle.resolve(handleParam);
    if (!did) return c.text("User not found", 404);

    const rows = await activityRows(ctx.db, { kind: "user", did }, feedParams(c));
    const handle = isDid(handleParam)
      ? ((await ctx.resolver.resolveDidToHandle(did)) ?? handleParam)
      : handleParam;

    const xml = rssFeed(
      {
        title: `BookHive | @${handle}'s activity`,
        link: `https://bookhive.buzz/profile/${handle}`,
        description: `Book activity for @${handle} on BookHive`,
      },
      rows.map((item) =>
        rssItem(item, {
          title: `${getActionText(item.status)} "${item.title}"`,
          link: `https://bookhive.buzz/books/${item.hiveId}`,
          descHtml:
            `<p><strong>${escapeXml(displayAuthors(item.authors))}</strong></p>` +
            ratingAndReview(item),
        }),
      ),
      rows[0]?.indexedAt,
    );

    return c.text(xml, 200, RSS_HEADERS);
  })
  .get("/book/:hiveId", async (c) => {
    const ctx = c.get("ctx");
    const hiveId = c.req.param("hiveId") as HiveId;

    const bookRow = await ctx.db
      .selectFrom("hive_book")
      .select(["title", "authors"])
      .where("id", "=", hiveId)
      .executeTakeFirst();
    if (!bookRow) return c.text("Book not found", 404);

    const rows = await activityRows(ctx.db, { kind: "book", hiveId }, feedParams(c));
    const didHandleMap = await ctx.resolver.resolveDidsToHandles([
      ...new Set(rows.map((r) => r.userDid)),
    ]);
    const bookTitle = bookRow.title ?? hiveId;

    const xml = rssFeed(
      {
        title: `BookHive | "${bookTitle}" activity`,
        link: `https://bookhive.buzz/books/${hiveId}`,
        description: `Reader activity for "${bookTitle}" by ${primaryAuthor(bookRow.authors)} on BookHive`,
      },
      rows.map((item) => {
        const handle = didHandleMap[item.userDid] ?? item.userDid;
        const actionText = getActionText(item.status);
        return rssItem(item, {
          title: `@${handle} ${actionText}`,
          link: `https://bookhive.buzz/profile/${handle}`,
          descHtml:
            `<p><strong>@${escapeXml(handle)}</strong> ${escapeXml(actionText)}</p>` +
            ratingAndReview(item),
        });
      }),
      rows[0]?.indexedAt,
    );

    return c.text(xml, 200, RSS_HEADERS);
  })
  .get("/friends/:handle", async (c) => {
    const ctx = c.get("ctx");
    const handleParam = c.req.param("handle");

    const did = isDid(handleParam)
      ? handleParam
      : await ctx.baseIdResolver.handle.resolve(handleParam);
    if (!did) return c.text("User not found", 404);

    const rows = await activityRows(ctx.db, { kind: "friends", did }, feedParams(c));
    const handle = isDid(handleParam)
      ? ((await ctx.resolver.resolveDidToHandle(did)) ?? handleParam)
      : handleParam;

    const xml = rssFeed(
      {
        title: `BookHive | @${handle}'s friends' activity`,
        link: `https://bookhive.buzz/profile/${handle}`,
        description: `Book activity from accounts followed by @${handle} on BookHive`,
      },
      rows.map((item) =>
        rssItem(item, {
          title: `${getActionText(item.status)} "${item.title}"`,
          link: `https://bookhive.buzz/books/${item.hiveId}`,
          descHtml:
            `<p><strong>${escapeXml(displayAuthors(item.authors))}</strong></p>` +
            ratingAndReview(item),
        }),
      ),
      rows[0]?.indexedAt,
    );

    return c.text(xml, 200, RSS_HEADERS);
  });

export default app;
