import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SessionClient } from "../auth/client";
import { type Database } from "../db";
import { WANTTOREAD } from "../constants";
import { createTestDb, testContext } from "../test/db";
import { refetchBooks, refetchBuzzes } from "./lib";

const did = "did:plc:alice";
const bookDefaults = {
  status: WANTTOREAD,
  owned: 0,
  startedAt: null,
  finishedAt: null,
  stars: null,
  review: null,
  bookProgress: null,
  previousReads: null,
  record: null,
};
let db: Database;
beforeEach(async () => {
  ({ db } = await createTestDb());
});
afterEach(async () => {
  await db.destroy();
});

for (const [table, sync] of [
  ["user_book", refetchBooks],
  ["buzz", refetchBuzzes],
] as const) {
  describe(`${table} re-sync pagination`, () => {
    const uri = `at://${did}/record/old`;
    async function seed() {
      const common = {
        uri,
        cid: "cid",
        userDid: did,
        hiveId: "bk_a" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        indexedAt: "2026-01-01T00:00:00.000Z",
      };
      if (table === "user_book") {
        await db
          .insertInto(table)
          .values({ ...bookDefaults, ...common, title: "Old", authors: "Author" })
          .execute();
      } else {
        await db
          .insertInto(table)
          .values({
            ...common,
            comment: "Old",
            bookUri: "at://book",
            bookCid: "cid",
            parentUri: "at://parent",
            parentCid: "cid",
          })
          .execute();
      }
    }
    const remaining = () => db.selectFrom(table).select("uri").execute();
    function run(
      get: (method: string, options: { params: { cursor?: string } }) => Promise<unknown>,
    ) {
      return sync({ agent: { did, get } as unknown as SessionClient, ctx: testContext({ db }) });
    }

    it("follows short and empty pages with cursors before pruning", async () => {
      await seed();
      const cursors: Array<string | undefined> = [];
      await run(async (_method, { params }) => {
        cursors.push(params.cursor);
        if (!params.cursor)
          return { ok: true, data: { records: [{ value: {} }], cursor: "short" } };
        if (params.cursor === "short") return { ok: true, data: { records: [], cursor: "empty" } };
        expect(await remaining()).toEqual([{ uri }]);
        return { ok: true, data: { records: [] } };
      });
      expect(cursors).toEqual([undefined, "short", "empty"]);
      expect(await remaining()).toEqual([]);
    });

    it("finishes a full page without a cursor without fetching page one again", async () => {
      await seed();
      let calls = 0;
      await run(async () => {
        if (++calls > 1) throw new Error("unexpected extra request");
        return { ok: true, data: { records: Array.from({ length: 100 }, () => ({ value: {} })) } };
      });
      expect(calls).toBe(1);
      expect(await remaining()).toEqual([]);
    });

    it("keeps and updates a valid record returned after a short page", async () => {
      await seed();
      const ctx = testContext({ db });
      await ctx.kv.set("search:Recovered", []);
      await ctx.kv.setMeta("search:Recovered", { timestamp: Date.now() });
      const bookUri = `at://${did}/buzz.bookhive.book/3m4tfwok4ns2c`;
      const cid = "bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
      const createdAt = "2026-01-01T00:00:00.000Z";
      if (table === "buzz") {
        await db
          .insertInto("user_book")
          .values({
            ...bookDefaults,
            uri: bookUri,
            cid,
            userDid: did,
            hiveId: "bk_a",
            title: "Book",
            authors: "Author",
            createdAt,
            indexedAt: createdAt,
          })
          .execute();
      }
      const value =
        table === "user_book"
          ? {
              $type: "buzz.bookhive.book",
              title: "Recovered",
              authors: "Author",
              hiveId: "bk_a",
              createdAt,
              hiveBookUri: bookUri,
            }
          : {
              $type: "buzz.bookhive.buzz",
              comment: "Recovered",
              createdAt,
              book: { uri: bookUri, cid },
              parent: { uri: bookUri, cid },
            };
      await sync({
        ctx,
        agent: {
          did,
          get: async (_method: string, { params }: { params: { cursor?: string } }) => ({
            ok: true,
            data: params.cursor
              ? { records: [{ uri, cid, value }] }
              : { records: [], cursor: "next" },
          }),
        } as unknown as SessionClient,
      });
      expect(await remaining()).toEqual([{ uri }]);
      const row = await db.selectFrom(table).selectAll().executeTakeFirstOrThrow();
      expect(
        table === "user_book"
          ? (row as { title: string }).title
          : (row as { comment: string }).comment,
      ).toBe("Recovered");
    });

    for (const failure of [
      "nonOK",
      "transport",
      "repeated",
      "cycle",
      "limit",
      "malformed",
    ] as const) {
      it(`rejects ${failure} scans without pruning existing records`, async () => {
        await seed();
        let calls = 0;
        expect(
          run(async () => {
            calls++;
            if (calls === 1) return { ok: true, data: { records: [], cursor: "a" } };
            if (failure === "nonOK") return { ok: false };
            if (failure === "transport") throw new Error("network error");
            if (failure === "malformed") return { ok: true, data: { records: [], cursor: 123 } };
            return {
              ok: true,
              data: {
                records: [],
                cursor:
                  failure === "limit"
                    ? `page-${calls}`
                    : failure === "cycle" && calls === 2
                      ? "b"
                      : "a",
              },
            };
          }),
        ).rejects.toThrow();
        expect(calls).toBe(failure === "limit" ? 500 : failure === "cycle" ? 3 : 2);
        expect(await remaining()).toEqual([{ uri }]);
      });
    }

    it("prunes an authoritatively empty collection", async () => {
      await seed();
      await run(async () => ({ ok: true, data: { records: [] } }));
      expect(await remaining()).toEqual([]);
    });
  });
}
