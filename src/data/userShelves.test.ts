import { expect, test } from "bun:test";
import { BOOK_STATUS } from "../constants";
import { createTestDb } from "../test/db";
import { listShelf } from "./userShelves";

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
