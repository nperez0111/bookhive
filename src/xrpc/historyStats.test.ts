import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SessionClient } from "../auth/client";
import { BOOK_STATUS } from "../constants";
import { createTestDb } from "../test/db";
import { xrpcReadApp } from "../test/xrpcReadApp";
import type { BuzzBookhiveGetBook, BuzzBookhiveGetReadingStats } from "../bsky/lexicon/generated";

const DID = "did:plc:viewer";
const OTHER_DID = "did:plc:other";
const HIVE_ID = "bk_history";
const NOW = "2026-01-01T00:00:00.000Z";
let database: Awaited<ReturnType<typeof createTestDb>>;

function createApp(did: string | null = DID) {
  return xrpcReadApp({
    db: database.db,
    getSessionAgent: async () => (did ? ({ did } as SessionClient) : null),
  }).app;
}

beforeEach(async () => {
  database = await createTestDb();
  await database.db
    .insertInto("hive_book")
    .values({
      id: HIVE_ID,
      title: "History",
      rawTitle: "History",
      authors: "Author",
      source: "goodreads",
      thumbnail: "",
      enrichAttempts: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .execute();
});

afterEach(async () => {
  await database.close();
});

describe("getBook history and catalogue shelves", () => {
  async function seedHistory() {
    for (let page = 1; page <= 22; page++) {
      await database.db
        .insertInto("progress_history")
        .values({
          userDid: DID,
          hiveId: HIVE_ID,
          currentPage: page,
          totalPages: 100,
          percent: page,
          createdAt: NOW,
        })
        .execute();
    }
    await database.db
      .insertInto("progress_history")
      .values([
        {
          userDid: OTHER_DID,
          hiveId: HIVE_ID,
          currentPage: 999,
          totalPages: 999,
          percent: 100,
          createdAt: NOW,
        },
        {
          userDid: DID,
          hiveId: "bk_other",
          currentPage: 888,
          totalPages: 999,
          percent: 89,
          createdAt: NOW,
        },
        {
          userDid: DID,
          hiveId: HIVE_ID,
          currentPage: null,
          totalPages: null,
          percent: 0,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ])
      .execute();
  }

  it("returns only viewer/book history, newest first with the web's 20-entry cap", async () => {
    await seedHistory();
    const response = await createApp().request(`/xrpc/buzz.bookhive.getBook?id=${HIVE_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BuzzBookhiveGetBook.$output;
    expect(body.progressHistory).toHaveLength(20);
    expect(body.progressHistory?.[0]).toEqual({
      createdAt: "2026-01-02T00:00:00.000Z",
      percent: 0,
    });
    expect(body.progressHistory?.slice(1).map((row) => row.currentPage)).toEqual(
      Array.from({ length: 19 }, (_, i) => 22 - i),
    );
  });

  it("omits viewer-only fields for anonymous requests; signed-in empty history is an empty array", async () => {
    await seedHistory();
    const anonymous = await createApp(null).request(`/xrpc/buzz.bookhive.getBook?id=${HIVE_ID}`);
    expect(anonymous.status).toBe(200);
    const body = (await anonymous.json()) as BuzzBookhiveGetBook.$output;
    expect(body.progressHistory).toBeUndefined();
    expect(body.shelves).toBeUndefined();
    const empty = await createApp("did:plc:empty").request(
      `/xrpc/buzz.bookhive.getBook?id=${HIVE_ID}`,
    );
    expect(((await empty.json()) as BuzzBookhiveGetBook.$output).progressHistory).toEqual([]);
  });

  it("returns own and other public catalogue memberships, never private ebook shelves", async () => {
    for (const userDid of [DID, OTHER_DID]) {
      const uri = `at://${userDid}/social.popfeed.feed.list/shelf`;
      await database.db
        .insertInto("book_list")
        .values({
          uri,
          cid: "cid",
          userDid,
          name: userDid,
          description: null,
          ordered: 0,
          tags: null,
          createdAt: NOW,
          indexedAt: NOW,
        })
        .execute();
      await database.db
        .insertInto("book_list_item")
        .values({
          uri: `at://${userDid}/social.popfeed.feed.listItem/item`,
          cid: "cid",
          userDid,
          listUri: uri,
          hiveId: HIVE_ID,
          description: null,
          position: null,
          addedAt: NOW,
          indexedAt: NOW,
          embeddedTitle: null,
          embeddedAuthor: null,
          embeddedCoverUrl: null,
          identifiers: null,
        })
        .execute();
      await database.db
        .insertInto("personal_shelf")
        .values({
          userDid,
          name: "Private ebooks",
          description: null,
          createdAt: NOW,
          updatedAt: NOW,
        })
        .execute();
    }
    const response = await createApp().request(`/xrpc/buzz.bookhive.getBook?id=${HIVE_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BuzzBookhiveGetBook.$output;
    expect(body.shelves).toHaveLength(2);
    expect(body.shelves?.map((shelf) => shelf.userDid).sort()).toEqual([OTHER_DID, DID].sort());
    expect(
      body.shelves?.every(
        (shelf) =>
          shelf.uri.includes("/social.popfeed.feed.list/") &&
          shelf.itemUri.includes("/social.popfeed.feed.listItem/"),
      ),
    ).toBe(true);
  });
});

describe("getReadingStats fallback", () => {
  async function finishBook(index: number, year: number) {
    await database.db
      .insertInto("user_book")
      .values({
        uri: `at://${DID}/buzz.bookhive.book/${index}`,
        cid: "cid",
        userDid: DID,
        hiveId: HIVE_ID,
        title: `Book ${index}`,
        authors: "Author",
        createdAt: NOW,
        indexedAt: NOW,
        status: BOOK_STATUS.FINISHED,
        owned: 0,
        startedAt: null,
        finishedAt: `${year}-01-01T00:00:00.000Z`,
        review: null,
        stars: 8,
        bookProgress: JSON.stringify({ totalPages: 100 }),
        previousReads: null,
      })
      .execute();
  }

  async function stats() {
    const response = await createApp(null).request(
      `/xrpc/buzz.bookhive.getReadingStats?handle=${DID}&year=2025`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as BuzzBookhiveGetReadingStats.$output;
  }

  it("keeps yearly stats unchanged and exposes all-time stats below the existing threshold", async () => {
    await finishBook(1, 2025);
    await finishBook(2, 2025);
    await finishBook(3, 2024);
    const body = await stats();
    expect(body.year).toBe(2025);
    expect(body.showYearInBooks).toBe(false);
    expect(body.stats.booksCount).toBe(2);
    expect(body.stats.pagesRead).toBe(200);
    expect(body.allTimeStats?.booksCount).toBe(3);
    expect(body.allTimeStats?.pagesRead).toBe(300);
    expect(body.allTimeStats?.averageRating).toBe(40);
    expect(body.allTimeStats?.ratingDistribution.four).toBe(3);
    expect(body.availableYears).toContain(2024);
  });

  it("omits all-time fallback at exactly three finished books in the year", async () => {
    for (let i = 1; i <= 3; i++) await finishBook(i, 2025);
    const body = await stats();
    expect(body.showYearInBooks).toBe(true);
    expect(body.stats.booksCount).toBe(3);
    expect(body.allTimeStats).toBeUndefined();
  });

  it("exposes empty all-time stats for an empty library", async () => {
    const body = await stats();
    expect(body.showYearInBooks).toBe(false);
    expect(body.stats.booksCount).toBe(0);
    expect(body.allTimeStats?.booksCount).toBe(0);
    expect(body.allTimeStats?.pagesRead).toBe(0);
  });
});
