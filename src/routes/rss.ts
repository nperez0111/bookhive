/**
 * RSS feed routes for user and friends activity.
 * Mount at /rss so paths are /rss/user/:handle and /rss/friends/:handle.
 */
import { Hono } from "hono";
import { isDid } from "@atcute/lexicons/syntax";

import type { AppEnv } from "../context";
import { BookFields } from "../db";
import { BOOK_STATUS } from "../constants";

const STATUS_SHORTHAND: Record<string, string> = {
  finished: BOOK_STATUS.FINISHED,
  reading: BOOK_STATUS.READING,
  wantToRead: BOOK_STATUS.WANTTOREAD,
  abandoned: BOOK_STATUS.ABANDONED,
  owned: BOOK_STATUS.OWNED,
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
  userDid: string;
};

type ChannelMeta = {
  title: string;
  link: string;
  description: string;
};

function buildRssXml(items: FeedItem[], channel: ChannelMeta): string {
  const lastBuildDate =
    items.length > 0 && items[0]
      ? toRfc2822(items[0].createdAt)
      : toRfc2822(new Date().toISOString());

  const itemsXml = items
    .map((item) => {
      const actionText = getActionText(item.status);
      const authors = item.authors?.replace(/\t/g, ", ") ?? "";
      const starDisplay = item.stars != null ? item.stars / 2 : null;

      let descHtml = `<p><strong>${escapeXml(authors)}</strong></p>`;
      if (starDisplay != null) {
        descHtml += `<p>Rating: ${starDisplay} / 5</p>`;
      }
      if (item.review) {
        descHtml += `<p><em>${escapeXml(item.review)}</em></p>`;
      }

      return `    <item>
      <title>${escapeXml(`${actionText} "${item.title}"`)}</title>
      <link>https://bookhive.buzz/books/${escapeXml(item.hiveId)}</link>
      <guid isPermaLink="false">${escapeXml(item.uri)}</guid>
      <pubDate>${toRfc2822(item.createdAt)}</pubDate>
      <description><![CDATA[${descHtml}]]></description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;
}

const app = new Hono<AppEnv>()
  .get("/user/:handle", async (c) => {
    const ctx = c.get("ctx");
    const handleParam = c.req.param("handle");
    const statusFilter = parseStatusFilter(c.req.query("status"));
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));

    const did = isDid(handleParam)
      ? handleParam
      : await ctx.baseIdResolver.handle.resolve(handleParam);

    if (!did) {
      return c.text("User not found", 404);
    }

    let query = ctx.db
      .selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(BookFields)
      .where("user_book.userDid", "=", did)
      .orderBy("user_book.createdAt", "desc")
      .limit(limit);

    if (statusFilter) {
      query = query.where("user_book.status", "in", statusFilter) as typeof query;
    }

    const rows = await query.execute();

    const handle = isDid(handleParam)
      ? ((await ctx.resolver.resolveDidToHandle(did)) ?? handleParam)
      : handleParam;

    const xml = buildRssXml(rows, {
      title: `BookHive | @${handle}'s activity`,
      link: `https://bookhive.buzz/profile/${handle}`,
      description: `Book activity for @${handle} on BookHive`,
    });

    return c.text(xml, 200, { "Content-Type": "application/rss+xml; charset=utf-8" });
  })
  .get("/friends/:handle", async (c) => {
    const ctx = c.get("ctx");
    const handleParam = c.req.param("handle");
    const statusFilter = parseStatusFilter(c.req.query("status"));
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));

    const did = isDid(handleParam)
      ? handleParam
      : await ctx.baseIdResolver.handle.resolve(handleParam);

    if (!did) {
      return c.text("User not found", 404);
    }

    let query = ctx.db
      .selectFrom("user_book")
      .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
      .select(BookFields)
      .where(
        "user_book.userDid",
        "in",
        ctx.db
          .selectFrom("user_follows")
          .where("user_follows.userDid", "=", did)
          .where("user_follows.isActive", "=", 1)
          .select("user_follows.followsDid"),
      )
      .orderBy("user_book.createdAt", "desc")
      .limit(limit);

    if (statusFilter) {
      query = query.where("user_book.status", "in", statusFilter) as typeof query;
    }

    const rows = await query.execute();

    const handle = isDid(handleParam)
      ? ((await ctx.resolver.resolveDidToHandle(did)) ?? handleParam)
      : handleParam;

    const xml = buildRssXml(rows, {
      title: `BookHive | @${handle}'s friends' activity`,
      link: `https://bookhive.buzz/profile/${handle}`,
      description: `Book activity from accounts followed by @${handle} on BookHive`,
    });

    return c.text(xml, 200, { "Content-Type": "application/rss+xml; charset=utf-8" });
  });

export default app;
