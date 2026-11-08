import { expect, test } from "bun:test";
import { BookFields } from "../db";
import { BOOK_STATUS } from "../constants";
import { createTestDb } from "../test/db";
import { buildRssActivityQuery, listRssActivityRows } from "./rssActivity";

test("RSS reads only user books, retaining full reviews, indexedAt/URI order and pre-limit filters", async () => {
  const { db, sqlite, close } = await createTestDb();
  try {
    const review = "Full review\n".repeat(1000);
    for (const [id, did, status, indexedAt] of [
      ["a", "reader", BOOK_STATUS.FINISHED, "2026-01-03"],
      ["b", "reader", BOOK_STATUS.FINISHED, "2026-01-03"],
      ["c", "reader", BOOK_STATUS.READING, "2026-01-05"],
      ["d", "inactive", BOOK_STATUS.FINISHED, "2026-01-06"],
      ["e", "stranger", BOOK_STATUS.FINISHED, "2026-01-07"],
    ]) {
      sqlite
        .prepare(`INSERT INTO user_book (uri,cid,userDid,hiveId,title,authors,status,review,createdAt,indexedAt)
        VALUES (?, 'cid', ?, 'bk_fixture', ?, 'Author', ?, ?, '2020-01-01', ?)`)
        .run(`at://fixture/book/${id}`, did!, id!, status!, review, indexedAt!);
    }
    sqlite.exec(`INSERT INTO user_follows (userDid,followsDid,isActive,followedAt,syncedAt,lastSeenAt) VALUES
      ('me','reader',1,'2026-01-01','2026-01-01','2026-01-01'), ('me','inactive',0,'2026-01-01','2026-01-01','2026-01-01')`);
    const params = { limit: 2, statusFilter: [BOOK_STATUS.FINISHED] };
    for (const scope of [
      { kind: "user", did: "reader" },
      { kind: "friends", did: "me" },
      { kind: "book", hiveId: "bk_fixture" },
    ] as const) {
      const rows = await listRssActivityRows(db, scope, params);
      const baseline = db
        .selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .select(BookFields)
        .where("user_book.status", "in", params.statusFilter)
        .orderBy("user_book.indexedAt", "desc")
        .orderBy("user_book.uri", "desc")
        .limit(2);
      const expected = await (
        scope.kind === "user"
          ? baseline.where("user_book.userDid", "=", "reader")
          : scope.kind === "book"
            ? baseline.where("user_book.hiveId", "=", scope.hiveId)
            : baseline.where(
                "user_book.userDid",
                "in",
                db
                  .selectFrom("user_follows")
                  .select("followsDid")
                  .where("userDid", "=", "me")
                  .where("isActive", "=", 1),
              )
      ).execute();
      expect(expected).toMatchObject(rows);
      expect(rows[0]?.review).toBe(review);
      expect(rows[0]).not.toHaveProperty("description");
      const compiled = buildRssActivityQuery(db, scope, params).compile();
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`)
        .all(...(compiled.parameters as never[]))
        .map((r) => (r as { detail: string }).detail)
        .join("\n");
      expect(plan).not.toContain("hive_book");
      expect(plan).not.toContain("SCAN user_book");
    }
    expect(
      (await listRssActivityRows(db, { kind: "user", did: "reader" }, params)).map((b) => b.title),
    ).toEqual(["b", "a"]);
  } finally {
    await close();
  }
});
