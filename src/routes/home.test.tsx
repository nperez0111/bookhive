import { expect, test } from "bun:test";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { timing } from "hono/timing";
import type { AppEnv } from "../context";
import { BOOK_STATUS } from "../constants";
import { createTestDb, testContext } from "../test/db";
import pages from "./pages";

test("Home gives empty shelves useful next steps and preserves completed-book order", async () => {
  const { db, sqlite, close } = await createTestDb();
  try {
    const ctx = testContext({
      db,
      getProfile: async () => ({ did: "did:plc:reader", handle: "reader.test" }),
    });
    const app = new Hono<AppEnv>();
    app.use(timing());
    app.use(async (c, next) => {
      c.set("ctx", ctx);
      await next();
    });
    app.use(jsxRenderer());
    app.route("/", pages);
    const empty = await (await app.request("/home")).text();
    expect(empty).toContain("<h1");
    expect(empty).toContain('href="/search" data-open-search');
    expect(empty).toContain("Discover your next read");
    expect(empty).toContain("Explore books");
    expect(empty).toContain("<dl");
    expect(empty.indexOf('aria-label="Currently Reading"')).toBeLessThan(
      empty.indexOf('aria-label="Want to Read"'),
    );
    expect(empty.indexOf('aria-label="Want to Read"')).toBeLessThan(
      empty.indexOf('aria-label="Finished Reading"'),
    );

    for (const [id, title, status, finishedAt] of [
      ["bk_old", "Earlier finish", BOOK_STATUS.FINISHED, "2026-01-01"],
      ["bk_new", "Latest finish", BOOK_STATUS.FINISHED, "2026-02-01"],
      ["bk_queue", "My next book", BOOK_STATUS.WANTTOREAD, null],
    ]) {
      sqlite
        .prepare(`INSERT INTO user_book (uri, cid, userDid, hiveId, title, authors, status, createdAt, indexedAt, finishedAt)
        VALUES (?, 'cid', 'did:plc:reader', ?, ?, 'An Author', ?, '2026-01-01', '2026-01-01', ?)`)
        .run(
          `at://did:plc:reader/buzz.bookhive.book/${id}`,
          id!,
          title!,
          status!,
          finishedAt ?? null,
        );
    }
    const populated = await (await app.request("/home")).text();
    expect(populated).toContain("Choose from your books");
    expect(populated).not.toContain("Discover your next read");
    expect(populated.indexOf("Latest finish")).toBeLessThan(populated.indexOf("Earlier finish"));
    expect(populated).toContain("An Author");
    expect(populated).toContain("h-[2.5em]");
  } finally {
    await close();
  }
});
