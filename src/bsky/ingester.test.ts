import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { reconcileUserRepo } from "./ingester";
import { createTestDb, testKv } from "../test/db";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { BOOK_STATUS } from "../constants";

const DID = "did:plc:alice";
const URI = `at://${DID}/buzz.bookhive.book/aaa`;
const HIVE_ID = "bk_test" as HiveId;
const OLD = "2026-01-01T00:00:00.000Z";
const book = {
  $type: "buzz.bookhive.book",
  hiveId: HIVE_ID,
  title: "Dune",
  authors: "Frank Herbert",
  createdAt: OLD,
  status: BOOK_STATUS.FINISHED,
  stars: 8,
  review: "Updated on another client",
  finishedAt: "2026-10-13T00:00:00.000Z",
  bookProgress: { percent: 100, updatedAt: OLD },
};

let db: Database;
let kv = testKv();
let logs: Record<string, unknown>[];
let request: (url: URL) => Promise<Response>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  kv = testKv();
  logs = [];
  await db
    .insertInto("hive_book")
    .values({
      id: HIVE_ID,
      title: "Dune",
      authors: "Frank Herbert",
      source: "goodreads",
      thumbnail: "",
      createdAt: OLD,
      updatedAt: OLD,
      enrichAttempts: 0,
    })
    .execute();
  await db
    .insertInto("user_book")
    .values({
      uri: URI,
      cid: "old-cid",
      userDid: DID,
      hiveId: HIVE_ID,
      title: book.title,
      authors: book.authors,
      createdAt: OLD,
      indexedAt: OLD,
      status: BOOK_STATUS.READING,
      owned: 0,
    })
    .execute();
});
afterEach(async () => {
  await db.destroy();
});

function respond(input: string | URL | Request) {
  const url = new URL(input instanceof Request ? input.url : input);
  expect(url.pathname).toBe("/xrpc/com.atproto.repo.listRecords");
  return Response.json({
    records:
      url.searchParams.get("collection") === "buzz.bookhive.book"
        ? [{ uri: URI, cid: "pds-cid", value: book }]
        : [],
  });
}
const reconcile = () =>
  reconcileUserRepo(
    DID,
    db,
    kv,
    (event) => logs.push(event),
    async () => "https://pds.test",
    request,
  );
const mirrored = () =>
  db.selectFrom("user_book").selectAll().where("uri", "=", URI).executeTakeFirstOrThrow();

describe("PDS reconciliation", () => {
  it("repairs stale records, saves the raw record, and leaves unchanged activity dates alone", async () => {
    request = async (input) => respond(input);
    expect(await reconcile()).toBe(true);
    const row = await mirrored();
    expect(row.cid).toBe("pds-cid");
    expect(row.status).toBe(BOOK_STATUS.FINISHED);
    expect(row.stars).toBe(8);
    expect(row.review).toBe(book.review);
    expect(JSON.parse(row.bookProgress!)).toEqual(book.bookProgress);
    expect(JSON.parse(row.record!)).toMatchObject(book);
    expect(row.indexedAt).not.toBe(OLD);
    expect(await kv.get(`reconciled_at:${DID}`)).toBeTruthy();
    expect(logs.at(-1)).toMatchObject({ outcome: "reconcile_complete", repaired: 1 });
    expect(await reconcile()).toBe(true);
    expect((await mirrored()).indexedAt).toBe(row.indexedAt);
    expect(logs.at(-1)).toMatchObject({ repaired: 0 });
  });

  it("does not overwrite a newer live update received during a PDS fetch", async () => {
    request = async (input) => {
      await db
        .updateTable("user_book")
        .set({ cid: "newer-live-cid", review: "Even newer" })
        .where("uri", "=", URI)
        .execute();
      return respond(input);
    };
    expect(await reconcile()).toBe(true);
    expect(await mirrored()).toMatchObject({ cid: "newer-live-cid", review: "Even newer" });
  });

  it("inserts a missing book from a later PDS page", async () => {
    await db.deleteFrom("user_book").execute();
    request = async (url) => {
      if (
        url.searchParams.get("collection") === "buzz.bookhive.book" &&
        !url.searchParams.has("cursor")
      ) {
        return Response.json({
          records: [],
          cursor: "next",
        });
      }
      return respond(url);
    };
    expect(await reconcile()).toBe(true);
    expect((await mirrored()).cid).toBe("pds-cid");
  });

  it("does not re-date activity when only progress changes", async () => {
    request = async (input) => respond(input);
    expect(await reconcile()).toBe(true);
    await db
      .updateTable("user_book")
      .set({
        cid: "progress-behind",
        indexedAt: OLD,
        bookProgress: JSON.stringify({ percent: 99, updatedAt: OLD }),
      })
      .execute();
    expect(await reconcile()).toBe(true);
    const row = await mirrored();
    expect(row.indexedAt).toBe(OLD);
    expect(JSON.parse(row.bookProgress!)).toEqual(book.bookProgress);
  });

  it("does not resurrect a row deleted during a PDS fetch", async () => {
    request = async (input) => {
      await db.deleteFrom("user_book").where("uri", "=", URI).execute();
      return respond(input);
    };
    expect(await reconcile()).toBe(true);
    expect(await db.selectFrom("user_book").select("uri").execute()).toEqual([]);
  });

  it("does not mark a partially failed scan complete, and repairs it on retry", async () => {
    request = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      return url.searchParams.get("collection") === "buzz.bookhive.buzz"
        ? new Response("Unavailable", { status: 503 })
        : respond(input);
    };
    expect(await reconcile()).toBe(false);
    expect(await kv.get(`reconciled_at:${DID}`)).toBeNull();
    expect(logs.at(-1)).toMatchObject({ outcome: "reconcile_error" });
    request = async (input) => respond(input);
    expect(await reconcile()).toBe(true);
    expect(await kv.get(`reconciled_at:${DID}`)).toBeTruthy();
  });

  it("recovers shelf metadata and ranking, including same-CID mirrors from migration 029", async () => {
    const listUri = `at://${DID}/social.popfeed.feed.list/ranked`;
    const itemUri = `at://${DID}/social.popfeed.feed.listItem/first`;
    await db
      .insertInto("book_list")
      .values({
        uri: listUri,
        cid: "list-cid",
        userDid: DID,
        name: "Ranked",
        description: "Old description",
        ordered: 1,
        createdAt: OLD,
        indexedAt: OLD,
      })
      .execute();
    request = async (url) =>
      url.searchParams.get("collection") === "social.popfeed.feed.list"
        ? Response.json({
            records: [
              {
                uri: listUri,
                cid: "list-cid",
                value: {
                  $type: "social.popfeed.feed.list",
                  name: "Ranked",
                  description: "Updated on Popfeed",
                  ordered: true,
                  itemOrder: [itemUri],
                  createdAt: OLD,
                },
              },
            ],
          })
        : Response.json({ records: [] });
    expect(await reconcile()).toBe(true);
    const row = await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow();
    expect(row.description).toBe("Updated on Popfeed");
    expect(row.itemOrder).toBe(JSON.stringify([itemUri]));
    expect(await reconcile()).toBe(true);
    expect(logs.at(-1)).toMatchObject({ repaired: 0 });
    expect((await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow()).indexedAt).toBe(
      row.indexedAt,
    );
  });
});
