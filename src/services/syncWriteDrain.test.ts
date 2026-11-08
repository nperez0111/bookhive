import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createTestDb, testKv } from "../test/db";
import {
  enqueuePdsWrite,
  acquireSyncWriteLease,
  releaseSyncWriteLease,
  renewSyncWriteLease,
  importLegacySyncWrites,
  SYNC_WRITE_LEASE_MS,
} from "../data/syncWriteQueue";
import { drainSyncWrites } from "./syncWriteDrain";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, migrateToLatest } from "../db";

const DID = "did:plc:sync-queue";
const BOOK = "bk_queue";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("durable sync writes", () => {
  let fixture: Awaited<ReturnType<typeof createTestDb>>;
  let kv: ReturnType<typeof testKv>;
  beforeEach(async () => {
    fixture = await createTestDb();
    kv = testKv();
    await fixture.db
      .insertInto("user_book")
      .values({
        uri: `at://${DID}/buzz.bookhive.book/one`,
        cid: "cid",
        userDid: DID,
        hiveId: BOOK,
        title: "Book",
        authors: "Author",
        createdAt: "",
        indexedAt: "",
        status: null,
        owned: 0,
      })
      .execute();
  });
  afterEach(async () => {
    await kv.dispose();
    await fixture.close();
  });
  const enqueue = (bookProgress: string, hiveId: `bk_${string}` = BOOK) =>
    enqueuePdsWrite(fixture.db, DID, { hiveId, bookProgress });
  const pending = () => fixture.db.selectFrom("sync_write_queue").selectAll().execute();
  const drain = (write: (entry: { bookProgress: string }) => Promise<void>) =>
    drainSyncWrites({ db: fixture.db, kv, userDid: DID, write });

  for (const fails of [false, true]) {
    it(`preserves newer progress when an older write ${fails ? "fails" : "succeeds"}`, async () => {
      await enqueue("old");
      const entered = deferred(),
        finish = deferred();
      const running = drain(async () => {
        entered.resolve();
        await finish.promise;
        if (fails) throw new Error("offline");
      });
      await entered.promise;
      await enqueue("new");
      finish.resolve();
      await running;
      expect((await pending()).map((entry) => entry.bookProgress)).toEqual(["new"]);
      const written: string[] = [];
      await drain(async (entry) => {
        written.push(entry.bookProgress);
      });
      expect(written).toEqual(["new"]);
      expect(await pending()).toEqual([]);
    });
  }

  it("does not lose concurrent producers for different books", async () => {
    await Promise.all([enqueue("one"), enqueue("two", "bk_other")]);
    expect(await pending()).toHaveLength(2);
  });

  it("allows only one drain while a transport is still running", async () => {
    await enqueue("old");
    const entered = deferred(),
      finish = deferred();
    let calls = 0;
    const running = drain(async () => {
      calls++;
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    await drain(async () => {
      calls++;
    });
    expect(calls).toBe(1);
    finish.resolve();
    await running;
    expect(await pending()).toEqual([]);
  });

  it("retries failures on the next opportunity and releases ownership", async () => {
    await enqueue("old");
    await drain(async () => {
      throw new Error("offline");
    });
    expect(await pending()).toHaveLength(1);
    await drain(async () => {});
    expect(await pending()).toEqual([]);
  });

  it("does not starve a healthy later book behind a full failing batch", async () => {
    for (let i = 0; i < 101; i++) {
      const hiveId = `bk_${String(i).padStart(3, "0")}` as const;
      await fixture.db
        .insertInto("user_book")
        .values({
          uri: `at://${DID}/buzz.bookhive.book/${i}`,
          cid: "cid",
          userDid: DID,
          hiveId,
          title: "Book",
          authors: "Author",
          createdAt: "",
          indexedAt: "",
          status: null,
          owned: 0,
        })
        .execute();
      await enqueue("progress", hiveId);
    }
    await fixture.db.updateTable("sync_write_queue").set({ enqueuedAt: "2020-01-01" }).execute();
    const written: string[] = [];
    const write = async (entry: { hiveId: string }) => {
      written.push(entry.hiveId);
      if (entry.hiveId !== "bk_100") throw new Error("failing book");
    };
    await drainSyncWrites({ db: fixture.db, kv, userDid: DID, write });
    expect(written).not.toContain("bk_100");
    await drainSyncWrites({ db: fixture.db, kv, userDid: DID, write });
    expect(written).toContain("bk_100");
    expect((await pending()).some((entry) => entry.hiveId === "bk_100")).toBe(false);
  });

  it("drops only the observed revision of an untracked book without creating it", async () => {
    await enqueue("old", "bk_untracked");
    let called = false;
    await drain(async () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(await pending()).toEqual([]);
  });

  it("imports legacy entries once without overwriting new SQL progress", async () => {
    await kv.setItem(`sync_pending:${DID}`, [
      { hiveId: BOOK, bookProgress: "legacy" },
      { hiveId: "bk_other", bookProgress: "other" },
      null,
      { hiveId: "invalid", bookProgress: "bad" },
    ]);
    await enqueue("current");
    await importLegacySyncWrites(fixture.db, kv, DID);
    expect((await pending()).find((entry) => entry.hiveId === BOOK)?.bookProgress).toBe("current");
    expect(await pending()).toHaveLength(2);
    await fixture.db.deleteFrom("sync_write_queue").execute();
    await kv.setItem(`sync_pending:${DID}`, [{ hiveId: BOOK, bookProgress: "legacy" }]);
    await importLegacySyncWrites(fixture.db, kv, DID);
    expect(await pending()).toEqual([]);
  });

  it("retries legacy import after a failed KV read without marking it complete", async () => {
    await kv.setItem(`sync_pending:${DID}`, [{ hiveId: BOOK, bookProgress: "legacy" }]);
    const read = spyOn(kv, "getItem").mockRejectedValueOnce(new Error("KV unavailable"));
    try {
      const result = await importLegacySyncWrites(fixture.db, kv, DID).then(
        () => null,
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe("KV unavailable");
    } finally {
      read.mockRestore();
    }
    const state = await fixture.db.selectFrom("sync_write_state").selectAll().executeTakeFirst();
    expect(state?.legacyImported ?? 0).toBe(0);
    await importLegacySyncWrites(fixture.db, kv, DID);
    expect((await pending())[0]?.bookProgress).toBe("legacy");
  });

  it("does not touch legacy KV again after import even if removal failed", async () => {
    const key = `sync_pending:${DID}`;
    await kv.setItem(key, [{ hiveId: BOOK, bookProgress: "legacy" }]);
    const read = spyOn(kv, "getItem");
    const remove = spyOn(kv, "removeItem").mockRejectedValue(new Error("KV unavailable"));
    try {
      await importLegacySyncWrites(fixture.db, kv, DID);
      expect((await pending())[0]?.bookProgress).toBe("legacy");
      // A successful write is acknowledged despite the inert legacy key remaining.
      await drain(async () => {});
      await drain(async () => {});
      expect(await pending()).toEqual([]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
      remove.mockRestore();
    }
    expect(await kv.getItem(key)).toEqual([{ hiveId: BOOK, bookProgress: "legacy" }]);
  });

  it("does not acknowledge or release a replacement owner after losing its lease", async () => {
    await enqueue("progress");
    const entered = deferred(),
      finish = deferred();
    const running = drain(async () => {
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    await fixture.db.updateTable("sync_write_state").set({ leaseToken: "replacement" }).execute();
    finish.resolve();
    await running;
    expect(await pending()).toHaveLength(1);
    const state = await fixture.db
      .selectFrom("sync_write_state")
      .select("leaseToken")
      .executeTakeFirst();
    expect(state?.leaseToken).toBe("replacement");
  });

  it("fences stale lease renew/release after crash expiry and replacement", async () => {
    const old = await acquireSyncWriteLease(fixture.db, DID, Date.now() - SYNC_WRITE_LEASE_MS - 1);
    expect(old).not.toBeNull();
    const current = await acquireSyncWriteLease(fixture.db, DID);
    expect(current).not.toBeNull();
    expect(current).not.toBe(old);
    expect(await renewSyncWriteLease(fixture.db, DID, old!)).toBe(false);
    await releaseSyncWriteLease(fixture.db, DID, old!);
    expect(await acquireSyncWriteLease(fixture.db, DID)).toBeNull();
    await releaseSyncWriteLease(fixture.db, DID, current!);
    expect(await acquireSyncWriteLease(fixture.db, DID)).not.toBeNull();
  });

  it("shares lease exclusion and queued revisions across separate SQLite connections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bookhive-sync-write-"));
    const first = createDb(`${dir}/queue.sqlite`);
    const second = createDb(`${dir}/queue.sqlite`);
    try {
      await migrateToLatest(first.db);
      const owner = await acquireSyncWriteLease(first.db, DID);
      expect(owner).not.toBeNull();
      expect(await acquireSyncWriteLease(second.db, DID)).toBeNull();
      await enqueuePdsWrite(second.db, DID, { hiveId: BOOK, bookProgress: "new" });
      expect(
        (await first.db.selectFrom("sync_write_queue").selectAll().execute())[0]?.bookProgress,
      ).toBe("new");
      await releaseSyncWriteLease(first.db, DID, owner!);
      expect(await acquireSyncWriteLease(second.db, DID)).not.toBeNull();
    } finally {
      await first.db.destroy();
      await second.db.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
