import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AUTHOR_DIRECTORY_LIMIT, getAuthorStats } from "../data/authorStats";
import type { BuzzBookhiveListAuthors } from "../bsky/lexicon/generated";
import { createTestDb } from "../test/db";
import { xrpcReadApp } from "../test/xrpcReadApp";

let database: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  database = await createTestDb();
});
afterEach(async () => {
  await database.close();
});

function createApp() {
  return xrpcReadApp({ db: database.db });
}

async function addAuthor(author: string, count = 2, ratingsCount = 10, language = "en") {
  await database.db
    .insertInto("hive_book")
    .values(
      Array.from({ length: count }, (_, index) => ({
        id: `bk_${author}_${language}_${index}` as `bk_${string}`,
        title: `${author} ${index}`,
        rawTitle: `${author} ${index}`,
        authors: author,
        source: "goodreads" as const,
        thumbnail: "",
        enrichAttempts: 0,
        ratingsCount,
        rating: 4000,
        language,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
    )
    .execute();
}

async function request(app: ReturnType<typeof createApp>["app"], query = "") {
  const response = await app.request(`/xrpc/buzz.bookhive.listAuthors${query ? `?${query}` : ""}`);
  expect(response.status).toBe(200);
  return (await response.json()) as BuzzBookhiveListAuthors.$output;
}

describe("listAuthors", () => {
  it("filters the same bounded web directory before paging, preserving popularity and author tiebreaks", async () => {
    await addAuthor("Alpha", 2, 10);
    await addAuthor("Beta", 2, 10);
    await addAuthor("Gamma", 2, 20);
    await addAuthor("Solo", 1, 100);
    const { app } = createApp();
    const first = await request(app, "limit=2");
    expect(first.authors.map((row) => row.author)).toEqual(["Gamma", "Alpha"]);
    expect(first.authors[0]).toMatchObject({ bookCount: 2, totalRatings: 40, avgRating: 40 });
    expect(first).toMatchObject({ offset: 2, total: 3, hasMore: true, directoryLimit: 500 });
    const second = await request(app, "limit=2&offset=2");
    expect(second.authors.map((row) => row.author)).toEqual(["Beta"]);
    expect(second).toMatchObject({ offset: 3, total: 3, hasMore: false });
    const filtered = await request(app, "q=%20ALP%20&limit=1");
    expect(filtered.authors.map((row) => row.author)).toEqual(["Alpha"]);
    expect(filtered).toMatchObject({ total: 1, offset: 1, hasMore: false });
    expect((await request(app, "q=missing")).total).toBe(0);
    expect((await request(app, "offset=500")).hasMore).toBe(false);
  });

  it("uses the supported language's actual statistics, not an all-language client filter", async () => {
    await addAuthor("Alpha", 3, 10, "en");
    await addAuthor("Beta", 2, 20, "en");
    await addAuthor("Alpha", 2, 30, "fr");
    await addAuthor("Beta", 3, 5, "fr");
    const { app, ctx } = createApp();
    const english = await request(app, "language=en");
    const french = await request(app, "language=fr");
    expect(english.authors.map((row) => [row.author, row.bookCount])).toEqual([
      ["Beta", 2],
      ["Alpha", 3],
    ]);
    expect(french.authors.map((row) => [row.author, row.bookCount])).toEqual([
      ["Alpha", 2],
      ["Beta", 3],
    ]);
    await request(app, "language=not-a-language");
    expect(await ctx.kv.hasItem("authors:stats:v1:not-a-language")).toBe(false);
  });

  it("shares the SWR aggregate and cap with the web; filtering and paging create no extra aggregate keys", async () => {
    for (let i = 0; i < AUTHOR_DIRECTORY_LIMIT + 1; i++) {
      await addAuthor(`Author${String(i).padStart(3, "0")}`);
    }
    const { app, ctx } = createApp();
    const webDirectory = await getAuthorStats(ctx.db, ctx.kv);
    expect(webDirectory).toHaveLength(500);
    const keys = await ctx.kv.getKeys("authors:");
    // Removing live rows proves this reads the already-filled SWR aggregate.
    await ctx.db.deleteFrom("hive_book").execute();
    const first = await request(app);
    expect(first.authors).toHaveLength(50);
    expect(first.total).toBe(500);
    expect(first.authors.map((row) => row.author)).toEqual(
      webDirectory.slice(0, 50).map((row) => row.author),
    );
    expect((await request(app, "q=Author500")).total).toBe(0);
    expect((await request(app, "q=Author499&offset=0&limit=1")).total).toBe(1);
    expect((await request(app, "offset=450&limit=100")).hasMore).toBe(false);
    expect(await ctx.kv.getKeys("authors:")).toEqual(keys);
  });

  it("validates all pagination and search parameters through the lexicon", async () => {
    const { app } = createApp();
    for (const query of [
      "limit=0",
      "limit=101",
      "offset=-1",
      "offset=501",
      "offset=0.5",
      `q=${"x".repeat(201)}`,
      `language=${"x".repeat(101)}`,
    ]) {
      expect((await app.request(`/xrpc/buzz.bookhive.listAuthors?${query}`)).status).toBe(400);
    }
  });
});
