import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { backfillUserRepo } from "./ingester";
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
const backfill = () =>
  backfillUserRepo(
    DID,
    db,
    kv,
    (event) => logs.push(event),
    async () => "https://pds.test",
    request,
  );
const mirrored = () =>
  db.selectFrom("user_book").selectAll().where("uri", "=", URI).executeTakeFirstOrThrow();

describe("discovery backfill", () => {
  it("leaves existing book records unchanged", async () => {
    request = async (input) => respond(input);
    await backfill();
    const row = await mirrored();
    expect(row.cid).toBe("old-cid");
    expect(row.status).toBe(BOOK_STATUS.READING);
    expect(row.indexedAt).toBe(OLD);
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
    await backfill();
    const row = await mirrored();
    expect(row.cid).toBe("pds-cid");
    expect(JSON.parse(row.record!)).toMatchObject(book);
    expect(await kv.get(`backfill_done:${DID}`)).toBeTruthy();
    expect(logs.at(-1)).toMatchObject({ outcome: "backfill_complete" });
  });

  it("does not mark a failed scan complete, allowing a later attempt", async () => {
    request = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      return url.searchParams.get("collection") === "buzz.bookhive.buzz"
        ? new Response("Unavailable", { status: 503 })
        : respond(input);
    };
    await backfill();
    expect(await kv.get(`backfill_done:${DID}`)).toBeNull();
    expect(logs.at(-1)).toMatchObject({ outcome: "backfill_error" });
    request = async (input) => respond(input);
    await backfill();
    expect(await kv.get(`backfill_done:${DID}`)).toBeTruthy();
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
    await backfill();
    const row = await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow();
    expect(row.description).toBe("Updated on Popfeed");
    expect(row.itemOrder).toBe(JSON.stringify([itemUri]));
  });
});
