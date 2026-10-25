import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SessionClient } from "../auth/client";
import type { AppContext } from "../context";
import { bookListUpsertSet, type Database } from "../db";
import { createTestDb } from "../test/db";
import { refetchLists } from "./lib";

const did = "did:plc:fip3nyk6tjo3senpq4ei2cxw";
const collection = "social.popfeed.feed.list";
const uri = `at://${did}/${collection}/3m4tfwok4ns2c`;
const itemUri = `at://${did}/social.popfeed.feed.listItem/3msh5aguwfsrm`;
let db: Database;

beforeEach(async () => {
  ({ db } = await createTestDb());
});
afterEach(async () => {
  await db.destroy();
});

const listRecord = (name = "Favorite Books") => ({
  uri,
  cid: "new-cid",
  value: {
    $type: collection,
    name,
    description: "Includes: books and novels",
    ordered: true,
    itemOrder: [itemUri],
    tags: ["favorite"],
    createdAt: "2025-11-04T20:49:53.339Z",
  },
});

async function seed() {
  await db
    .insertInto("book_list")
    .values({
      uri,
      cid: "old-cid",
      userDid: did,
      name: "Old name",
      description: "Old description",
      ordered: 0,
      itemOrder: null,
      tags: null,
      createdAt: "2025-11-04T20:49:53.339Z",
      indexedAt: "2025-11-04T20:49:53.339Z",
    })
    .execute();
}

function agentWith(
  get: (
    method: string,
    options: { params: { collection: string; cursor?: string } },
  ) => Promise<unknown>,
) {
  return { did, get } as unknown as SessionClient;
}
const ctx = () => ({ db }) as AppContext;

describe("Popfeed shelf recovery", () => {
  it("recovers a missing shelf and repairs stale metadata and itemOrder", async () => {
    const agent = agentWith(async (_method, { params }) => ({
      ok: true,
      data: { records: params.collection === collection ? [listRecord()] : [] },
    }));
    await refetchLists({ agent, ctx: ctx() });
    expect((await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow()).name).toBe(
      "Favorite Books",
    );
    await db
      .updateTable("book_list")
      .set({ description: "Old", ordered: 0, itemOrder: null })
      .execute();
    await refetchLists({ agent, ctx: ctx() });
    const row = await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow();
    expect(row.description).toBe("Includes: books and novels");
    expect(row.ordered).toBe(1);
    expect(row.itemOrder).toBe(JSON.stringify([itemUri]));
    expect(row.tags).toBe(JSON.stringify(["favorite"]));
  });

  it("follows a cursor even on a short page, without pruning unseen shelves", async () => {
    await seed();
    const cursors: Array<string | undefined> = [];
    const agent = agentWith(async (_method, { params }) => {
      if (params.collection !== collection) return { ok: true, data: { records: [] } };
      cursors.push(params.cursor);
      return {
        ok: true,
        data: params.cursor ? { records: [listRecord()] } : { records: [], cursor: "next-page" },
      };
    });
    await refetchLists({ agent, ctx: ctx() });
    expect(cursors).toEqual([undefined, "next-page"]);
    expect((await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow()).name).toBe(
      "Favorite Books",
    );
  });

  it("does not prune existing shelves after a failed PDS page", async () => {
    await seed();
    const agent = agentWith(async () => ({ ok: false }));
    await refetchLists({ agent, ctx: ctx() });
    expect((await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow()).name).toBe(
      "Old name",
    );
  });

  it("shared ingestion upsert replaces and clears list-level ranking", async () => {
    await seed();
    const row = await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow();
    await db
      .insertInto("book_list")
      .values({ ...row, ordered: 1, itemOrder: JSON.stringify([itemUri]) })
      .onConflict((oc) => oc.column("uri").doUpdateSet(bookListUpsertSet))
      .execute();
    expect((await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow()).itemOrder).toBe(
      JSON.stringify([itemUri]),
    );
    await db
      .insertInto("book_list")
      .values({ ...row, ordered: 0, itemOrder: null })
      .onConflict((oc) => oc.column("uri").doUpdateSet(bookListUpsertSet))
      .execute();
    expect(
      (await db.selectFrom("book_list").selectAll().executeTakeFirstOrThrow()).itemOrder,
    ).toBeNull();
  });

  for (const target of [collection, "social.popfeed.feed.listItem"]) {
    for (const repeated of [true, false]) {
      it(`rejects ${repeated ? "repeated cursors" : "cursor cycles after 500 pages"} for ${target} without pruning`, async () => {
        await seed();
        await db
          .insertInto("book_list_item")
          .values({
            uri: itemUri,
            cid: "old-item-cid",
            userDid: did,
            listUri: uri,
            addedAt: "2025-11-04T20:49:53.339Z",
            indexedAt: "2025-11-04T20:49:53.339Z",
          })
          .execute();
        let pages = 0;
        const agent = agentWith(async (_method, { params }) => {
          if (params.collection !== target) {
            return { ok: true, data: { records: [listRecord()] } };
          }
          pages++;
          return {
            ok: true,
            data: { records: [], cursor: repeated || pages % 2 ? "a" : "b" },
          };
        });
        const failure = await refetchLists({ agent, ctx: ctx() }).catch((error: unknown) => error);
        expect(failure).toMatchObject({
          message: expect.stringContaining(repeated ? "repeated" : "page limit"),
        });
        expect(pages).toBe(repeated ? 2 : 500);
        expect(await db.selectFrom("book_list").select("uri").execute()).toEqual([{ uri }]);
        expect(await db.selectFrom("book_list_item").select("uri").execute()).toEqual([
          { uri: itemUri },
        ]);
      });
    }
  }
});
