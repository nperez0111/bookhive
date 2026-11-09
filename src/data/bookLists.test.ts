import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestDb } from "../test/db";
import { getListWithItems, getUserLists } from "../services/lists";
import {
  buildShelfPreviewsQuery,
  getShelfMetadata,
  listShelfPreviews,
  listShelfSummaries,
} from "./bookLists";

const did = "did:plc:shelfowner";
const now = "2026-11-01T00:00:00.000Z";
let fixture: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  fixture = await createTestDb();
});
afterEach(async () => {
  await fixture.close();
});

function seed(counts: number[], owner = did, equalDates = false) {
  const listInsert = fixture.sqlite.prepare(`INSERT INTO book_list
    (uri,cid,userDid,name,description,ordered,itemOrder,tags,createdAt,indexedAt)
    VALUES (?,'cid',?,?,'Description',1,?,'["tag"]',?,?)`);
  const itemInsert = fixture.sqlite.prepare(`INSERT INTO book_list_item
    (uri,cid,userDid,listUri,hiveId,position,addedAt,indexedAt,embeddedTitle,embeddedAuthor,embeddedCoverUrl)
    VALUES (?,'cid',?,?,?, ?,?,?,?,'Embedded author','https://example.test/embedded.jpg')`);
  return counts.map((count, listIndex) => {
    const uri = `at://${owner}/social.popfeed.feed.list/${listIndex}`;
    const itemUris = Array.from(
      { length: count },
      (_, index) => `${uri}/item/${String(index).padStart(4, "0")}`,
    );
    listInsert.run(
      uri,
      owner,
      `Shelf ${listIndex}`,
      JSON.stringify(itemUris),
      new Date(Date.parse(now) + listIndex).toISOString(),
      now,
    );
    // Reverse insertion order makes the deterministic URI tie break observable.
    for (let index = count - 1; index >= 0; index--) {
      itemInsert.run(
        itemUris[index]!,
        owner,
        uri,
        index === 0 ? "bk_catalogue" : "bk_missing",
        index,
        equalDates ? now : new Date(Date.parse(now) + index).toISOString(),
        now,
        `Embedded ${index}`,
      );
    }
    return uri;
  });
}

test("1000 memberships hydrate only ten previews per list, with exact legacy values and full counts", async () => {
  const uris = seed(Array.from({ length: 10 }, () => 100));
  seed([11], "did:plc:other");
  const { db, sqlite } = fixture;
  sqlite.exec(`INSERT INTO hive_book (id,title,authors,source,createdAt,updatedAt,cover,thumbnail,rating)
    VALUES ('bk_catalogue','Catalogue title','Catalogue author','goodreads','${now}','${now}','cover','thumbnail',4)`);
  const legacy = await db
    .selectFrom("book_list_item")
    .leftJoin("hive_book", "book_list_item.hiveId", "hive_book.id")
    .select([
      "book_list_item.listUri",
      "book_list_item.hiveId",
      "book_list_item.embeddedTitle",
      "book_list_item.embeddedAuthor",
      "book_list_item.embeddedCoverUrl",
      "hive_book.cover",
      "hive_book.thumbnail",
      "hive_book.title",
      "hive_book.authors",
      "hive_book.rating",
    ])
    .where("book_list_item.listUri", "in", uris)
    .orderBy("book_list_item.addedAt", "desc")
    .execute();
  const previews = await listShelfPreviews({ db, userDid: did });
  expect(legacy).toHaveLength(1000);
  expect(previews).toHaveLength(100);
  for (const uri of uris) {
    expect(previews.filter((row) => row.listUri === uri)).toEqual(
      legacy.filter((row) => row.listUri === uri).slice(0, 10),
    );
  }
  const summaries = await listShelfSummaries({ db, userDid: did });
  const full = await getUserLists({ db, userDid: did });
  expect(full).toMatchObject(summaries);
  expect(summaries.map((row) => row.uri)).toEqual([...uris].reverse());
  expect(summaries.every((row) => row.itemCount === 100)).toBe(true);
  expect(summaries[0]).not.toHaveProperty("itemOrder");
  expect(summaries[0]).not.toHaveProperty("tags");
  expect(full[0]?.itemOrder).toBeTruthy();
  // The complete ranked shelf remains complete and follows itemOrder, not preview recency.
  const shelf = await getListWithItems({ db, listUri: uris[0]! });
  expect(shelf?.items).toHaveLength(100);
  expect(shelf?.items[0]?.embeddedTitle).toBe("Embedded 0");
  expect(previews[0]?.embeddedTitle).toBe("Embedded 99");
});

test("empty, nine, ten and eleven-item shelves use URI ascending for equal-date cutoffs", async () => {
  const uris = seed([0, 9, 10, 11], did, true);
  const { db, sqlite } = fixture;
  sqlite.exec(`INSERT INTO hive_book (id,title,authors,source,createdAt,updatedAt,cover,thumbnail,rating)
    VALUES ('bk_catalogue','Catalogue title','Catalogue author','goodreads','${now}','${now}','cover','thumbnail',4)`);
  const previews = await listShelfPreviews({ db, userDid: did });
  for (const [index, count] of [0, 9, 10, 11].entries()) {
    const rows = previews.filter((row) => row.listUri === uris[index]);
    expect(rows.map((row) => row.embeddedTitle)).toEqual(
      Array.from({ length: Math.min(count, 10) }, (_, i) => `Embedded ${i}`),
    );
    if (count > 0) {
      expect(rows[0]).toMatchObject({
        title: "Catalogue title",
        authors: "Catalogue author",
        cover: "cover",
        thumbnail: "thumbnail",
        rating: 4,
      });
      expect(rows[1]).toMatchObject({
        title: null,
        cover: null,
        embeddedTitle: "Embedded 1",
        embeddedAuthor: "Embedded author",
        embeddedCoverUrl: "https://example.test/embedded.jpg",
      });
    }
  }
  expect(await listShelfPreviews({ db, userDid: "did:plc:absent" })).toEqual([]);
});

test("preview plan limits covering ID probes before catalogue hydration", async () => {
  seed([100]);
  const query = buildShelfPreviewsQuery({ db: fixture.db, userDid: did }).compile();
  const plan = fixture.sqlite
    .query(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all(...(query.parameters as string[]));
  const details = plan.map((row) => (row as { detail: string }).detail).join("\n");
  expect(details).toContain(
    "SEARCH preview USING COVERING INDEX idx_book_list_item_preview (listUri=?)",
  );
  expect(details).toContain(
    "SEARCH book_list_item USING INDEX sqlite_autoindex_book_list_item_1 (uri=?)",
  );
  expect(details).toContain("SEARCH hive_book USING INDEX");
  expect(details).not.toMatch(/SCAN (?:preview|book_list_item|hive_book)/);
  expect(query.sql).toContain('order by "preview"."addedAt" desc, "preview"."uri" asc limit ?');
  expect(query.parameters).toContain(10);
});

test("edit metadata does not need item/catalogue tables or ranked order JSON", async () => {
  const [uri] = seed([100]);
  fixture.sqlite.exec("DROP TABLE book_list_item; DROP TABLE hive_book");
  const metadata = await getShelfMetadata({ db: fixture.db, listUri: uri! });
  expect(metadata).toEqual({
    uri: uri!,
    userDid: did,
    name: "Shelf 0",
    description: "Description",
    ordered: 1,
  });
  expect(await getShelfMetadata({ db: fixture.db, listUri: "missing" })).toBeUndefined();
});
