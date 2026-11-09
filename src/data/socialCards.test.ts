import { afterEach, beforeEach, expect, test } from "bun:test";

import { createTestDb } from "../test/db";
import { buildGenreCardCoversQuery, getGenreCardStats } from "./socialCards";

let fixture: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  fixture = await createTestDb();
});
afterEach(async () => fixture.close());

test("genre covers limit covering IDs before hydrating catalogue rows", () => {
  const query = buildGenreCardCoversQuery("Fiction", 6).compile(fixture.db);
  const plan = fixture.sqlite
    .query(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all(...(query.parameters as never[])) as { detail: string }[];
  const details = plan.map(({ detail }) => detail);
  expect(details.join("\n")).toContain("COVERING INDEX idx_hive_book_stats");
  // The wide-row lookup must be outside the bounded subquery, not inside its sort.
  expect(details.findIndex((detail) => detail.includes("SEARCH book USING INDEX"))).toBeGreaterThan(
    details.findIndex((detail) => detail.includes("SCAN selected")),
  );
  expect(details.join("\n")).not.toContain("SEARCH hive_book USING INDEX sqlite_autoindex");
});

test("genre card cover ordering, limits and counts match the original joined query", async () => {
  const { db, sqlite } = fixture;
  for (let i = 0; i < 40; i++) {
    sqlite.exec(
      `INSERT INTO hive_book
        (id,title,authors,source,cover,thumbnail,description,ratingsCount,createdAt,updatedAt)
       VALUES (?, 'Title', 'Author', 'goodreads', ?, ?, ?, ?, '2026-01-01', '2026-01-01')`,
      [
        `bk_${String(i).padStart(3, "0")}`,
        i % 3 ? `cover-${i}` : null,
        i % 4 ? `thumbnail-${i}` : "",
        "wide metadata ".repeat(400),
        i % 7 ? i % 5 : null,
      ],
    );
    sqlite.exec("INSERT INTO hive_book_genre (hiveId,genre) VALUES (?,?)", [
      `bk_${String(i).padStart(3, "0")}`,
      i < 35 ? "Fiction" : "Other",
    ]);
  }
  for (const genre of ["Fiction", "Other", "Missing"]) {
    for (const limit of [0, 1, 6, 50]) {
      const expected = sqlite
        .query<{ cover: string | null; thumbnail: string | null }, [string, number]>(
          `SELECT hive_book.cover, hive_book.thumbnail
           FROM hive_book JOIN hive_book_genre ON hive_book.id = hive_book_genre.hiveId
           WHERE hive_book_genre.genre = ?
           ORDER BY hive_book.ratingsCount DESC, hive_book.id ASC LIMIT ?`,
        )
        .all(genre, limit);
      const result = await getGenreCardStats({ db, genre, coverLimit: limit });
      expect(result.covers).toEqual(expected);
      expect(result.totalBooks).toBe(genre === "Fiction" ? 35 : genre === "Other" ? 5 : 0);
      expect(result.readerCount).toBe(0);
    }
  }
});
