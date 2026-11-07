import { expect, it } from "bun:test";
import { Hono } from "hono";
import { timing, setMetric, startTime, endTime } from "hono/timing";
import pino from "pino";
import { createStorage } from "unstorage";
import type { AppEnv } from "../context";
import { createTestDb } from "../test/db";
import { searchBooks } from "../services/searchBooks";
import { wideEventMiddleware } from "./wide-event";

function appWithLogs() {
  const events: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "info" },
    {
      write: (line: string) => {
        events.push(JSON.parse(line));
      },
    },
  );
  const app = new Hono<AppEnv>();
  // Match production: timing wraps wide-event, so its response header is not
  // present yet when the request event is emitted.
  app.use(timing({ autoEnd: false }));
  app.use(async (c, next) => {
    c.set("appLogger", logger);
    c.set("wideEventBag", {});
    await next();
  });
  app.use(wideEventMiddleware());
  return { app, events };
}

it("logs completed stage durations and promotes only allowlisted numeric search timings", async () => {
  const { app, events } = appWithLogs();
  app.get("/search", (c) => {
    startTime(c, "db_query");
    endTime(c, "db_query");
    setMetric(c, "region", "private description");
    c.set("wideEventBag", {
      search_upstream_ms: 12.34,
      search_local_ms: 1.23,
      search_lookup_ms: -1,
      search_session_ms: Infinity,
      arbitrary_private_ms: 99,
    });
    return c.text("ok");
  });
  const res = await app.request("/search");
  expect(res.headers.get("Server-Timing")).toContain("search_upstream;dur=12.3");
  expect(res.headers.get("Server-Timing")).not.toContain("arbitrary_private");
  expect(res.headers.get("Server-Timing")).not.toContain("search_session");
  expect(res.headers.get("Server-Timing")).not.toContain("search_lookup");
  const stages = events[0]!["server_timing_ms"] as Record<string, number>;
  expect(stages["db_query"]).toBeGreaterThanOrEqual(0);
  expect(stages["search_upstream"]).toBe(12.3);
  expect(stages["search_local"]).toBe(1.2);
  expect(stages).not.toHaveProperty("region");
});

it("does not attribute a cached response's historical timings to this request", async () => {
  const { app, events } = appWithLogs();
  app.get("/cached", (c) => {
    c.header("Server-Timing", "old_db;dur=9000");
    return c.text("cached");
  });
  expect((await app.request("/cached")).status).toBe(200);
  expect(events[0]).not.toHaveProperty("server_timing_ms");
});

it("records search cache lookup duration without inventing upstream work on a hit", async () => {
  const { db } = await createTestDb();
  const kv = createStorage();
  const query = `cached-${crypto.randomUUID()}`;
  await kv.set(`search:${query}`, []);
  await kv.setMeta(`search:${query}`, { timestamp: Date.now() });
  const { app, events } = appWithLogs();
  app.get("/search", async (c) => {
    const ids = await searchBooks({
      query,
      ctx: {
        db,
        kv,
        addWideEventContext: (fields) => Object.assign(c.get("wideEventBag"), fields),
      },
    });
    return c.json(ids);
  });
  try {
    const res = await app.request("/search");
    expect(await res.json()).toEqual([]);
    expect(res.headers.get("Server-Timing")).toContain("search_lookup;dur=");
    expect(res.headers.get("Server-Timing")).not.toContain("search_upstream");
    expect(events[0]).toHaveProperty("search_lookup_ms");
  } finally {
    await db.destroy();
    await kv.dispose();
  }
});
