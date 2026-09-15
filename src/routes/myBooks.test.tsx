import { expect, test } from "bun:test";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { AppEnv } from "../context";
import { createTestDb, testContext } from "../test/db";
import { BOOK_STATUS } from "../constants";
import pages from "./pages";

test("My Books requires sign-in and only renders the viewer's records, including DNF", async () => {
  const { db, sqlite, close } = await createTestDb();
  try {
    let signedIn = false;
    const ctx = testContext({
      db,
      getProfile: async () => (signedIn ? { did: "did:plc:reader", handle: "reader.test" } : null),
    });
    const app = new Hono<AppEnv>();
    app.use(async (c, next) => {
      c.set("ctx", ctx);
      await next();
    });
    app.use(jsxRenderer());
    app.route("/", pages);
    const anonymous = await app.request("/my-books");
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("Location")).toBe("/login");
    expect(anonymous.headers.get("Cache-Control")).toContain("no-store");

    signedIn = true;
    const empty = await app.request("/my-books");
    expect(await empty.text()).toContain("Your reading starts here");
    for (const [did, title, id] of [
      ["did:plc:reader", "My stopped book", "bk_mine"],
      ["did:plc:other", "Someone else's book", "bk_other"],
    ]) {
      sqlite
        .prepare(`INSERT INTO user_book (uri, cid, userDid, hiveId, title, authors, status, createdAt, indexedAt)
        VALUES (?, 'cid', ?, ?, ?, 'An Author', ?, '2026-01-01', '2026-01-01')`)
        .run(`at://${did}/buzz.bookhive.book/book`, did!, id!, title!, BOOK_STATUS.ABANDONED);
    }
    const response = await app.request("/my-books?userDid=did:plc:other");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const html = await response.text();
    expect(html).toContain('id="mount-library-table"');
    expect(html).toContain("My stopped book");
    expect(html).not.toContain("Someone else");
    expect(html).toContain('href="/books/bk_mine"');
  } finally {
    await close();
  }
});
