/**
 * AT Protocol feed generator endpoints.
 * Implements the three required endpoints for a Bluesky custom feed:
 *   GET /.well-known/did.json
 *   GET /xrpc/app.bsky.feed.describeFeedGenerator
 *   GET /xrpc/app.bsky.feed.getFeedSkeleton
 */
import { Hono } from "hono";
import { env } from "../env";
import type { AppEnv } from "../context";

const FEED_RKEY = "bookhive";

function getFeedGeneratorDid(): string {
  const hostname = new URL(env.PUBLIC_URL).hostname;
  return `did:web:${hostname}`;
}

function getFeedUri(): string {
  return `at://${getFeedGeneratorDid()}/app.bsky.feed.generator/${FEED_RKEY}`;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function feedGeneratorRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // DID document — required for feed generator service identity
  app.get("/.well-known/did.json", (c) => {
    const did = getFeedGeneratorDid();
    return c.json({
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: did,
      service: [
        {
          id: "#bsky_fg",
          type: "BskyFeedGenerator",
          serviceEndpoint: env.PUBLIC_URL,
        },
      ],
    });
  });

  // Feed generator metadata
  app.get("/xrpc/app.bsky.feed.describeFeedGenerator", (c) => {
    return c.json({
      did: getFeedGeneratorDid(),
      feeds: [
        {
          uri: getFeedUri(),
        },
      ],
    });
  });

  // Feed skeleton — returns post URIs for the BookHive feed
  app.get("/xrpc/app.bsky.feed.getFeedSkeleton", async (c) => {
    const feed = c.req.query("feed");
    const cursor = c.req.query("cursor");
    const limitParam = c.req.query("limit");
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT),
    );

    if (feed && feed !== getFeedUri()) {
      return c.json({ error: "UnsupportedAlgorithm" }, 400);
    }

    const ctx = c.get("ctx");

    let query = ctx.db
      .selectFrom("feed_post")
      .select(["uri", "createdAt"])
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (cursor) {
      query = query.where("createdAt", "<", cursor);
    }

    const rows = await query.execute();

    const feedItems = rows.map((row) => ({ post: row.uri }));
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.createdAt : undefined;

    return c.json({
      cursor: nextCursor,
      feed: feedItems,
    });
  });

  return app;
}
