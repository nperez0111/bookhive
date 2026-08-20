import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { Kysely, SqliteDialect } from "kysely";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import type { SessionClient } from "../auth/client";
import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import type { BookUtilContext } from "../context";
import { FINISHED, READING, WANTTOREAD } from "../constants";
import { migrateToLatest, type Database, type DatabaseSchema } from "../db";
import type { BookRecordValue, HiveId } from "../types";
import { getBookRecord, getUserBook, updateBookRecord } from "./getBook";
import { completeUserBookRecord } from "./userBookFollowUp";
import { recordFromUserBook } from "./userBookStore";
import { toUserBookView } from "./userBookView";

const DID = "did:plc:testuser";
const HIVE_ID = "bk_dune" as HiveId;
const RKEY = "3kabc";
const URI = `at://${DID}/buzz.bookhive.book/${RKEY}`;
const COVER = {
  $type: "blob",
  ref: { $link: "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy" },
  mimeType: "image/jpeg",
  size: 10,
};

async function createTestDb(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
  });
  await migrateToLatest(db, sqlite);
  return db;
}

type Call = { name: string; input: Record<string, unknown> };

/**
 * A PDS that holds one record and enforces `swapRecord`. `getRecord` answers
 * from `pds.record`; `putRecord` only lands when the swap matches `pds.cid`.
 */
function fakePds(initial?: { value: BookRecordValue; cid: string }) {
  const pds = {
    record: initial ?? null,
    calls: [] as Call[],
    nextCid: 1,
    blobsUploaded: 0,
  };
  const agent: SessionClient = {
    did: DID,
    async get(name, opts) {
      pds.calls.push({ name, input: (opts?.["params"] ?? {}) as Record<string, unknown> });
      if (name === "com.atproto.repo.getRecord") {
        if (!pds.record) return { ok: false, data: { error: "RecordNotFound" } };
        return { ok: true, data: { uri: URI, cid: pds.record.cid, value: pds.record.value } };
      }
      throw new Error(`unexpected get ${name}`);
    },
    async post(name, opts) {
      const input = (opts?.["input"] ?? {}) as Record<string, unknown>;
      pds.calls.push({ name, input });
      const commit = () => {
        const cid = `cid${pds.nextCid++}`;
        pds.record = { value: input["record"] as BookRecordValue, cid };
        return { ok: true as const, data: { uri: URI, cid } };
      };
      switch (name) {
        case "com.atproto.repo.createRecord":
          return commit();
        case "com.atproto.repo.putRecord":
          if (input["swapRecord"] !== pds.record?.cid) {
            return {
              ok: false,
              data: { error: "InvalidSwap", message: "Record was at wrong CID" },
            };
          }
          return commit();
        case "com.atproto.repo.uploadBlob":
          pds.blobsUploaded++;
          return { ok: true, data: { blob: COVER } };
        default:
          throw new Error(`unexpected post ${name}`);
      }
    },
  };
  const names = () => pds.calls.map((c) => c.name.replace("com.atproto.repo.", ""));
  return { pds, agent, names };
}

const baseRecord = (over: Partial<BookRecordValue> = {}): BookRecordValue => ({
  $type: "buzz.bookhive.book",
  title: "Dune",
  authors: "Frank Herbert",
  hiveId: HIVE_ID,
  createdAt: "2026-01-01T00:00:00.000Z",
  status: WANTTOREAD,
  owned: true,
  cover: COVER as BookRecordValue["cover"],
  identifiers: { isbn13: "9780441013593" },
  hiveBookUri: "at://did:plc:bookhive/buzz.bookhive.hiveBook/dune",
  ...over,
});

/** One-pixel PNG on a loopback port, so the cover path runs for real. */
function coverServer() {
  return Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64",
        ),
        { headers: { "content-type": "image/png" } },
      ),
  });
}

describe("updateBookRecord", () => {
  let db: Database;
  let ctx: BookUtilContext;
  let wide: Record<string, unknown>;

  beforeEach(async () => {
    db = await createTestDb();
    wide = {};
    ctx = {
      db,
      kv: createStorage({ driver: memoryDriver() }),
      serviceAccountAgent: null,
      addWideEventContext: (fields) => Object.assign(wide, fields),
    };
    await db
      .insertInto("hive_book")
      .values({
        id: HIVE_ID as never,
        title: "Dune",
        rawTitle: "Dune",
        authors: "Frank Herbert",
        source: "goodreads",
        thumbnail: "",
        cover: "http://127.0.0.1:1/cover.jpg",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never)
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedRow(record: BookRecordValue | null, cid: string, columns: object = {}) {
    await db
      .insertInto("user_book")
      .values({
        uri: URI,
        cid,
        userDid: DID,
        hiveId: HIVE_ID,
        title: "Dune",
        authors: "Frank Herbert",
        status: WANTTOREAD,
        owned: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        indexedAt: "2026-01-01T00:00:00.000Z",
        record: record ? JSON.stringify(record) : null,
        ...columns,
      })
      .execute();
  }

  it("merges locally and writes once with a CAS on the row's cid", async () => {
    const original = baseRecord();
    const { pds, agent, names } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0");

    const { book, userBook } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { status: FINISHED },
    });

    expect(names()).toEqual(["putRecord"]);
    expect(pds.calls[0]!.input["swapRecord"]).toBe("cid0");
    expect(wide["book_merge_source"]).toBe("local");

    expect(book.status).toBe(FINISHED);
    expect(book.finishedAt).toBeTruthy();
    // Fields only the record holds survive a merge that never read the PDS.
    expect(book.cover).toEqual(original.cover);
    expect(book.identifiers).toEqual(original.identifiers);
    expect(book.hiveBookUri).toBe(original.hiveBookUri!);

    expect(userBook.cid).toBe("cid1");
    const row = await getUserBook({ ctx, agent, hiveId: HIVE_ID });
    expect(row?.cid).toBe("cid1");
    expect(row?.status).toBe(FINISHED);
    expect(row?.record?.cover).toEqual(original.cover);
  });

  it("reads the PDS when the row predates the record column", async () => {
    const original = baseRecord({ stars: 8 });
    const { pds, agent, names } = fakePds({ value: original, cid: "cid0" });
    await seedRow(null, "cid0");

    const { book } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { status: READING },
    });

    expect(names()).toEqual(["getRecord", "putRecord"]);
    expect(pds.calls[0]!.input["cid"]).toBeUndefined();
    expect(pds.calls[1]!.input["swapRecord"]).toBe("cid0");
    expect(wide["book_merge_source"]).toBe("pds");
    expect(book.stars).toBe(8);

    const row = await getUserBook({ ctx, agent, hiveId: HIVE_ID });
    expect(row?.record).not.toBeNull();
  });

  it("re-merges against the PDS after a CAS conflict instead of overwriting", async () => {
    const stale = baseRecord();
    // Another client rated the book since our row last saw it.
    const current = baseRecord({ stars: 9, review: "Spice." });
    const { pds, agent, names } = fakePds({ value: current, cid: "cid-other" });
    await seedRow(stale, "cid0");

    const { book, userBook } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { status: FINISHED },
    });

    expect(names()).toEqual(["putRecord", "getRecord", "putRecord"]);
    expect(pds.calls[0]!.input["swapRecord"]).toBe("cid0");
    expect(pds.calls[2]!.input["swapRecord"]).toBe("cid-other");
    expect(wide["book_merge_source"]).toBe("pds_after_conflict");
    expect(book.status).toBe(FINISHED);
    expect(book.stars).toBe(9);
    expect(book.review).toBe("Spice.");
    expect(userBook.cid).toBe("cid1");
  });

  it("lets local columns win over the stored record", async () => {
    const record = baseRecord();
    const { agent } = fakePds({ value: record, cid: "cid0" });
    // KOSync wrote progress to the row; the PDS write for it is still queued.
    const progress = { percent: 40, updatedAt: "2026-02-01T00:00:00.000Z" };
    await seedRow(record, "cid0", { bookProgress: JSON.stringify(progress), status: READING });

    const { book } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { stars: 7 },
    });

    expect(book.status).toBe(READING);
    expect(book.bookProgress?.percent).toBe(40);
    expect(book.stars).toBe(7);
  });

  it("creates without an inline cover upload and patches the cover afterwards", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            "base64",
          ),
          { headers: { "content-type": "image/png" } },
        ),
    });
    try {
      const { pds, agent, names } = fakePds();

      const { book, userBook, followUp } = await updateBookRecord({
        ctx,
        agent,
        hiveId: HIVE_ID,
        updates: { status: WANTTOREAD, coverImage: `${server.url}cover.png` },
      });

      // The request path: one create, nothing else.
      expect(names()).toEqual(["createRecord"]);
      expect(book.cover).toBeUndefined();
      expect(userBook.cid).toBe("cid1");

      await expect(followUp).resolves.toBe("completed");
      expect(names()).toEqual(["createRecord", "uploadBlob", "putRecord"]);
      expect(pds.calls[2]!.input["swapRecord"]).toBe("cid1");
      expect(pds.record?.value.cover).toEqual(COVER as BookRecordValue["cover"]);

      const row = await getUserBook({ ctx, agent, hiveId: HIVE_ID });
      expect(row?.cid).toBe("cid2");
      expect(row?.record?.cover).toEqual(COVER as BookRecordValue["cover"]);
      expect(row?.status).toBe(WANTTOREAD);
    } finally {
      await server.stop(true);
    }
  });

  it("does not revert a column written while the follow-up is in flight", async () => {
    const server = coverServer();
    try {
      const { agent } = fakePds();
      // Create with no cover, so nothing is deferred yet and we hold the same
      // stale snapshot a real follow-up would have captured.
      const { userBook, followUp } = await updateBookRecord({
        ctx,
        agent,
        hiveId: HIVE_ID,
        updates: { status: WANTTOREAD, owned: false },
      });
      // The create's own follow-up is keyed by uri; let it settle so the one
      // under test isn't deduped onto it.
      await followUp;
      expect(userBook.owned).toBe(0);

      // A library upload marks the book owned, and KOSync pushes progress.
      // Neither column lives in the PDS record, so the CAS cannot protect them.
      await db
        .updateTable("user_book")
        .set({ owned: 1, bookProgress: JSON.stringify({ percent: 25, updatedAt: "x" }) })
        .where("uri", "=", URI)
        .execute();

      const outcome = await completeUserBookRecord({
        ctx,
        agent,
        userBook,
        coverImage: `${server.url}cover.png`,
      });
      expect(outcome).toBe("completed");

      const row = await getUserBook({ ctx, agent, hiveId: HIVE_ID });
      expect(row?.owned).toBe(1);
      expect(row?.bookProgress?.percent).toBe(25);
      expect(row?.record?.cover).toBeTruthy();
      expect(row?.cid).toBe("cid2");
    } finally {
      await server.stop(true);
    }
  });

  it("leaves the row alone when it has moved on since the follow-up was scheduled", async () => {
    const server = coverServer();
    try {
      const { agent } = fakePds();
      const { userBook, followUp } = await updateBookRecord({
        ctx,
        agent,
        hiveId: HIVE_ID,
        updates: { status: WANTTOREAD },
      });
      await followUp;
      // Another write lands first; the follow-up's snapshot cid is now stale.
      await db.updateTable("user_book").set({ cid: "cid-newer" }).where("uri", "=", URI).execute();

      await completeUserBookRecord({ ctx, agent, userBook, coverImage: `${server.url}cover.png` });

      const row = await getUserBook({ ctx, agent, hiveId: HIVE_ID });
      expect(row?.cid).toBe("cid-newer");
    } finally {
      await server.stop(true);
    }
  });

  it("skips the follow-up when the record is already complete", async () => {
    const original = baseRecord();
    const { agent, names } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0");

    const { followUp } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { stars: 10, coverImage: "http://127.0.0.1:1/never-fetched.jpg" },
    });

    await expect(followUp).resolves.toBe("nothing");
    expect(names()).toEqual(["putRecord"]);
  });

  it("drops a follow-up patch that loses the CAS race", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            "base64",
          ),
          { headers: { "content-type": "image/png" } },
        ),
    });
    try {
      const { pds, agent, names } = fakePds();
      const { followUp } = await updateBookRecord({
        ctx,
        agent,
        hiveId: HIVE_ID,
        updates: { status: WANTTOREAD, coverImage: `${server.url}cover.png` },
      });
      // Someone else writes before the cover lands.
      pds.record = { value: pds.record!.value, cid: "cid-elsewhere" };

      await expect(followUp).resolves.toBe("conflict");
      expect(names()).toEqual(["createRecord", "uploadBlob", "putRecord"]);
      const row = await getUserBook({ ctx, agent, hiveId: HIVE_ID });
      expect(row?.cid).toBe("cid1");
      expect(row?.record?.cover).toBeUndefined();
    } finally {
      await server.stop(true);
    }
  });

  it("keeps the start date when a partial update touches a book already Reading", async () => {
    // The common case: a rating or review save carries no dates at all.
    const original = baseRecord({ status: READING, startedAt: "2026-03-01T09:00:00.000Z" });
    const { agent } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0", { status: READING, startedAt: "2026-03-01T09:00:00.000Z" });

    const { book } = await updateBookRecord({ ctx, agent, hiveId: HIVE_ID, updates: { stars: 8 } });

    expect(book.startedAt).toBe("2026-03-01T09:00:00.000Z");
    expect(book.status).toBe(READING);
  });

  it("keeps the start date when progress is saved on a book already Reading", async () => {
    const original = baseRecord({ status: READING, startedAt: "2026-03-01T09:00:00.000Z" });
    const { agent } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0", { status: READING, startedAt: "2026-03-01T09:00:00.000Z" });

    // `/api/update-book` forces READING onto any progress write.
    const { book } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: {
        status: READING,
        bookProgress: { currentPage: 40, updatedAt: "2026-08-20T00:00:00.000Z" },
      },
    });

    expect(book.startedAt).toBe("2026-03-01T09:00:00.000Z");
  });

  it("stamps a fresh finish date when a book is finished again after an earlier read", async () => {
    // Dates left over from a previous read must not be presented as this one.
    const original = baseRecord({
      status: READING,
      startedAt: "2026-05-01T09:00:00.000Z",
      finishedAt: "2020-02-01T09:00:00.000Z",
    });
    const { agent } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0", {
      status: READING,
      startedAt: "2026-05-01T09:00:00.000Z",
      finishedAt: "2020-02-01T09:00:00.000Z",
    });

    const { book } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { status: FINISHED },
    });

    expect(book.finishedAt).not.toBe("2020-02-01T09:00:00.000Z");
    expect(new Date(book.finishedAt!).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it("still stamps a start date when the book has none", async () => {
    const original = baseRecord({ status: WANTTOREAD });
    const { agent } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0");

    const { book } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { status: READING },
    });

    expect(book.startedAt).toBeTruthy();
  });

  it("does not downgrade a finished book when only a date is edited", async () => {
    // The island sends `{ startedAt }` alone; reading that as "no status" used
    // to infer Reading and write it over the user's Finished.
    const original = baseRecord({
      status: FINISHED,
      startedAt: "2026-02-01T09:00:00.000Z",
      finishedAt: "2026-03-01T09:00:00.000Z",
    });
    const { agent } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0", {
      status: FINISHED,
      startedAt: "2026-02-01T09:00:00.000Z",
      finishedAt: "2026-03-01T09:00:00.000Z",
    });

    const { book } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { startedAt: "2026-02-05" },
    });

    expect(book.status).toBe(FINISHED);
    expect(book.finishedAt).toBe("2026-03-01T09:00:00.000Z");
    expect(book.startedAt?.startsWith("2026-02-05")).toBe(true);
  });

  it("still infers Reading when a start date is set on a want-to-read book", async () => {
    const original = baseRecord({ status: WANTTOREAD });
    const { agent } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0");

    const { book } = await updateBookRecord({
      ctx,
      agent,
      hiveId: HIVE_ID,
      updates: { startedAt: "2026-02-05" },
    });

    expect(book.status).toBe(READING);
  });

  it("refuses to create over an existing rkey when the record cannot be read", async () => {
    // Pre-025 row (no stored record) whose record the PDS will not give us.
    const { agent, names } = fakePds();
    await seedRow(null, "cid0");

    await expect(
      updateBookRecord({ ctx, agent, hiveId: HIVE_ID, updates: { status: FINISHED } }),
    ).rejects.toThrow(/could not read the current record/);

    // A create here would have written over whatever is actually at that rkey.
    expect(names()).toEqual(["getRecord"]);
  });

  it("surfaces a write failure that is not a swap conflict", async () => {
    const original = baseRecord();
    const { agent } = fakePds({ value: original, cid: "cid0" });
    await seedRow(original, "cid0");
    agent.post = async () => ({ ok: false, data: { error: "RateLimitExceeded" } });

    await expect(
      updateBookRecord({ ctx, agent, hiveId: HIVE_ID, updates: { status: FINISHED } }),
    ).rejects.toThrow(/RateLimitExceeded/);
  });
});

describe("getBookRecord", () => {
  it("returns the current cid alongside the value", async () => {
    const original = baseRecord();
    const { agent } = fakePds({ value: original, cid: "cid7" });
    const res = await getBookRecord({ agent, uri: URI });
    expect(res?.cid).toBe("cid7");
    expect(res?.value.title).toBe("Dune");
  });
});

describe("recordFromUserBook", () => {
  const row = {
    uri: URI,
    cid: "cid0",
    userDid: DID,
    hiveId: HIVE_ID,
    title: "Dune",
    authors: "Frank Herbert",
    createdAt: "2026-01-01T00:00:00.000Z",
    indexedAt: "2026-01-01T00:00:00.000Z",
    status: READING,
    owned: 0,
    startedAt: null,
    finishedAt: null,
    stars: null,
    review: null,
    bookProgress: null,
    previousReads: null,
  };

  it("is null without a stored record", () => {
    expect(recordFromUserBook({ ...row, record: null })).toBeNull();
  });

  it("keeps an old record's unset owned unset, but honours a column 1", () => {
    const record = baseRecord({ owned: undefined });
    expect(recordFromUserBook({ ...row, record })?.owned).toBeUndefined();
    expect(recordFromUserBook({ ...row, owned: 1, record })?.owned).toBe(true);
    expect(recordFromUserBook({ ...row, record: baseRecord({ owned: true }) })?.owned).toBe(false);
  });
});

describe("toUserBookView", () => {
  it("exposes owned as a boolean and hides the raw record", () => {
    const view = toUserBookView({
      uri: URI,
      cid: "cid0",
      userDid: DID,
      hiveId: HIVE_ID,
      title: "Dune",
      authors: "Frank Herbert",
      createdAt: "2026-01-01T00:00:00.000Z",
      indexedAt: "2026-01-01T00:00:00.000Z",
      status: READING,
      owned: 1,
      startedAt: null,
      finishedAt: null,
      stars: 8,
      review: null,
      bookProgress: null,
      previousReads: null,
      record: baseRecord(),
    });
    expect(view.owned).toBe(true);
    expect(view.stars).toBe(8);
    expect("record" in view).toBe(false);
    expect("userDid" in view).toBe(false);
  });
});
