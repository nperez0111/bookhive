import { expect, test } from "bun:test";
import { BOOK_STATUS } from "../constants";
import { createTestDb } from "../test/db";
import {
  listAllUserBooks,
  listProfileBooks,
  listReadingStatsBooks,
  listShelf,
  listTrackedBooks,
} from "./userShelves";
import { getReadingStatsForYear } from "./readingStats";
import { booksFinishedInYear } from "../core/readingYear";

test("finished shelf sorts by completion, sinks undated books and breaks ties by URI", async () => {
  const { db, sqlite, close } = await createTestDb();
  try {
    for (const [id, date, indexedAt, did, status] of [
      ["old", "2020-01-01", "2026-12-01", "reader", BOOK_STATUS.FINISHED],
      ["new-a", "2026-01-01", "2020-01-01", "reader", BOOK_STATUS.FINISHED],
      ["new-b", "2026-01-01", "2020-01-01", "reader", BOOK_STATUS.FINISHED],
      ["undated", null, "2026-12-01", "reader", BOOK_STATUS.FINISHED],
      ["other", "2027-01-01", "2027-01-01", "other", BOOK_STATUS.FINISHED],
      ["reading", "2027-01-01", "2027-01-01", "reader", BOOK_STATUS.READING],
    ]) {
      sqlite
        .prepare(`INSERT INTO user_book (uri, cid, userDid, hiveId, title, authors, status, createdAt, indexedAt, finishedAt)
        VALUES (?, 'cid', ?, ?, ?, 'Author', ?, '2020-01-01', ?, ?)`)
        .run(`at://fixture/book/${id}`, did!, `bk_${id}`, id!, status!, indexedAt!, date!);
    }
    const books = await listShelf({
      db,
      userDid: "reader",
      status: BOOK_STATUS.FINISHED,
      orderBy: "finishedAt",
    });
    expect(books.map((book) => book.title)).toEqual(["new-b", "new-a", "old", "undated"]);
  } finally {
    await close();
  }
});

test("purpose-specific projections preserve shelf, tracking and stats values without catalogue blobs", async () => {
  const { db, sqlite, close } = await createTestDb();
  try {
    const review = "Full displayed review\n".repeat(1000);
    const progress = JSON.stringify({ totalPages: 250, currentPage: 250 });
    const previousReads = JSON.stringify([{ startedAt: "2024-01-01", finishedAt: "2024-02-01" }]);
    for (const [id, did, status, finishedAt, bookProgress, meta, stars] of [
      ["a", "reader", BOOK_STATUS.FINISHED, "2026-01-01", progress, '{"numPages":"900"}', 10],
      ["b", "reader", BOOK_STATUS.FINISHED, "2026-01-01", "not-json", '{"numPages":"100"}', 8],
      ["c", "reader", BOOK_STATUS.FINISHED, "2026-12-31", "[]", '{"numPages":"100"}', null],
      ["old", "reader", BOOK_STATUS.FINISHED, "2025-01-01", null, "not-json", null],
      ["undated", "reader", BOOK_STATUS.FINISHED, null, null, null, null],
      ["reading", "reader", BOOK_STATUS.READING, null, "null", null, null],
      ["owned", "reader", null, null, null, null, null],
      ["other", "other", BOOK_STATUS.FINISHED, "2026-01-01", progress, null, 10],
    ] as const) {
      if (id !== "undated") {
        sqlite
          .prepare(`INSERT INTO hive_book (id,title,authors,source,createdAt,updatedAt,description,rawTitle,cover,thumbnail,rating,ratingsCount,meta)
          VALUES (?,?,'Author','goodreads','2020-01-01','2020-01-01',?,'Raw title','cover','thumbnail',4,100,?)`)
          .run(`bk_${id}`, id, "unused description ".repeat(1000), meta);
      }
      sqlite
        .prepare(`INSERT INTO user_book (uri,cid,userDid,hiveId,title,authors,status,review,stars,owned,createdAt,indexedAt,finishedAt,bookProgress,previousReads)
        VALUES (?,'cid',?,?,?,'Author',?,?,?,1,'2020-01-01','2026-11-01',?,?,?)`)
        .run(
          `at://fixture/book/${id}`,
          did,
          `bk_${id}`,
          id,
          status,
          review,
          stars,
          finishedAt,
          bookProgress,
          previousReads,
        );
    }
    sqlite.exec(
      `INSERT INTO hive_book_genre (hiveId,genre) VALUES ('bk_a','Fantasy'),('bk_b','Fantasy'),('bk_c','Fiction')`,
    );
    for (const orderBy of ["createdAt", "indexedAt"] as const) {
      const opts = { db, userDid: "reader", orderBy };
      const full = await listAllUserBooks(opts);
      const profile = await listProfileBooks(opts);
      const tracked = await listTrackedBooks(opts);
      const statsBooks = await listReadingStatsBooks(opts);
      expect(full).toMatchObject(profile);
      expect(full).toMatchObject(tracked);
      expect(full).toMatchObject(statsBooks);
      expect(profile.map((book) => book.hiveId)).toEqual(full.map((book) => book.hiveId));
      expect(profile.every((book) => book.review === review)).toBe(true);
      expect(booksFinishedInYear(profile, 2024)).toEqual(booksFinishedInYear(full, 2024));
      for (const rows of [profile, tracked, statsBooks]) {
        expect(rows).toHaveLength(7);
        for (const row of rows) {
          expect(row).not.toHaveProperty("description");
          expect(row).not.toHaveProperty("rawTitle");
        }
      }
      for (const row of [...tracked, ...statsBooks]) {
        expect(row).not.toHaveProperty("review");
        expect(row).not.toHaveProperty("previousReads");
      }
      expect(tracked.find((book) => book.title === "b")?.bookProgress).toBeNull();
      expect(tracked.find((book) => book.title === "c")?.bookProgress).toBeNull();
      expect(tracked.find((book) => book.title === "undated")?.cover).toBeNull();
      for (const year of [2026, 2025, 2024]) {
        const leanStats = await getReadingStatsForYear({ db, books: statsBooks, year });
        const fullStats = await getReadingStatsForYear({ db, books: full, year });
        // Every summary and winner field is identical; only unused winner payload is omitted.
        expect(fullStats).toMatchObject(leanStats);
        expect(leanStats.showYearInBooks).toBe(year === 2026);
        if (year === 2026) {
          expect(leanStats.stats.pagesRead).toBe(450);
          expect(leanStats.stats.shortestBook?.title).toBe("c");
          expect(leanStats.stats.mostPopularBook?.title).toBe("c");
          expect(leanStats.stats.firstBookOfYear?.title).toBe("b");
          expect(leanStats.stats.topGenres).toEqual([
            { genre: "Fantasy", count: 2 },
            { genre: "Fiction", count: 1 },
          ]);
        } else {
          expect(leanStats.allTimeStats?.booksCount).toBe(5);
        }
      }
      expect((await listProfileBooks({ ...opts, limit: 2 })).map((book) => book.hiveId)).toEqual(
        full.slice(0, 2).map((book) => book.hiveId),
      );
      expect((await listTrackedBooks({ ...opts, limit: 2 })).map((book) => book.hiveId)).toEqual(
        full.slice(0, 2).map((book) => book.hiveId),
      );
      expect(
        (await listReadingStatsBooks({ ...opts, limit: 2 })).map((book) => book.hiveId),
      ).toEqual(full.slice(0, 2).map((book) => book.hiveId));
    }
    // Shelf cards still need their complete review and historical reads, never description/rawTitle.
    const shelf = await listShelf({ db, userDid: "reader", status: BOOK_STATUS.FINISHED });
    expect(shelf).toHaveLength(5);
    expect(shelf[0]?.review).toBe(review);
    expect(shelf[0]?.previousReads).toHaveLength(1);
    expect(shelf[0]).not.toHaveProperty("description");
  } finally {
    await close();
  }
});

test("purpose-specific listings retain the 10,000-book scope and URI tie order", async () => {
  const { db, sqlite, close } = await createTestDb();
  try {
    const insert =
      sqlite.prepare(`INSERT INTO user_book (uri,cid,userDid,hiveId,title,authors,createdAt,indexedAt)
      VALUES (?,'cid','reader','bk_fixture',?,'Author','2026-01-01','2026-01-01')`);
    sqlite.transaction(() => {
      for (let i = 0; i < 10002; i++)
        insert.run(`at://fixture/book/${String(i).padStart(5, "0")}`, String(i).padStart(5, "0"));
    })();
    for (const listing of [listProfileBooks, listTrackedBooks, listReadingStatsBooks]) {
      const books = await listing({ db, userDid: "reader" });
      expect(books).toHaveLength(10000);
      expect(books[0]?.title).toBe("10001");
      expect(books[9999]?.title).toBe("00002");
      expect(await listing({ db, userDid: "missing" })).toEqual([]);
    }
    const full = await listAllUserBooks({ db, userDid: "reader", limit: 2 });
    expect(full.map((book) => book.uri)).toEqual([
      "at://fixture/book/10001",
      "at://fixture/book/10000",
    ]);
  } finally {
    await close();
  }
});
