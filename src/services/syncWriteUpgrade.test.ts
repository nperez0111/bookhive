import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "unstorage";
import { createDb, migrateToLatest } from "../db";
import sqliteKv from "../sqlite-kv";
import { enqueuePdsWrite, type PendingWrite } from "../data/syncWriteQueue";
import { drainSyncWrites } from "./syncWriteDrain";

const DID = "did:plc:upgrade";
const LEGACY = { hiveId: "bk_upgradelegacy", bookProgress: '{"percent":25}' } as const;
const CONFLICT = { hiveId: "bk_upgradeconflict", bookProgress: '{"percent":10}' } as const;
const NEWER = { ...CONFLICT, bookProgress: '{"percent":90}' };
const KEY = `sync_pending:${DID}`;

describe("upgrade from origin/main b1b55b8 through migration 032", () => {
  let root: string;
  let connection: ReturnType<typeof createDb>;
  let kv: ReturnType<typeof createStorage>;
  const openKv = () => {
    const storage = createStorage();
    storage.mount(
      "sync_pending",
      sqliteKv({ location: join(root, "kv.sqlite"), table: "sync_pending" }),
    );
    return storage;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bookhive-upgrade-"));
    connection = createDb(join(root, "main.sqlite"));
    // This is the actual historical schema/history, not latest migrated down.
    connection.sqlite.exec(
      await Bun.file(new URL("../test/fixtures/sync-upgrade-032.sql", import.meta.url)).text(),
    );
    for (const { hiveId } of [LEGACY, CONFLICT]) {
      await connection.db
        .insertInto("user_book")
        .values({
          uri: `at://${DID}/buzz.bookhive.book/${hiveId}`,
          cid: `old-${hiveId}`,
          userDid: DID,
          hiveId,
          title: "Existing book",
          authors: "Existing author",
          createdAt: "2026-01-01T00:00:00.000Z",
          indexedAt: "2026-02-01T00:00:00.000Z",
          status: "reading",
          owned: 1,
          bookProgress: '{"percent":5}',
          record: '{"preserve":"original record"}',
        })
        .execute();
    }
    await connection.db
      .insertInto("user_follows")
      .values(
        [0, 1].map((isActive) => ({
          userDid: DID,
          followsDid: `did:plc:follow-${isActive}`,
          followedAt: "2026-01-02T00:00:00.000Z",
          syncedAt: "2026-01-03T00:00:00.000Z",
          lastSeenAt: "2026-01-03T00:00:00.000Z",
          isActive,
        })),
      )
      .execute();
    kv = openKv();
  });

  afterEach(async () => {
    await kv.dispose();
    await connection.db.destroy();
    await rm(root, { recursive: true, force: true });
  });

  it("applies only 033/034, preserving historical rows, history and reverse-follow index", async () => {
    const { db, sqlite } = connection;
    const history = () => sqlite.query("SELECT * FROM kysely_migration ORDER BY name").all();
    const oldHistory = history();
    expect(oldHistory).toHaveLength(32);
    expect(oldHistory.at(-1)).toMatchObject({ name: "032" });
    expect(
      sqlite
        .query(
          "SELECT name FROM sqlite_schema WHERE name IN ('sync_write_queue', 'sync_write_state', 'follow_sync_state')",
        )
        .all(),
    ).toEqual([]);
    const books = await db.selectFrom("user_book").selectAll().orderBy("uri").execute();
    const follows = await db.selectFrom("user_follows").selectAll().orderBy("followsDid").execute();
    const reverseIndex = () =>
      sqlite
        .query("SELECT sql FROM sqlite_schema WHERE name = 'idx_user_follows_reverse_active'")
        .get();
    const oldIndex = reverseIndex();
    expect(oldIndex).toMatchObject({
      sql: expect.stringContaining("followsDid, isActive, followedAt DESC, userDid DESC"),
    });
    const ftsTriggers = () =>
      sqlite
        .query<{ name: string; sql: string }, []>(
          "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND name IN ('hive_book_fts_ai', 'hive_book_fts_ad', 'hive_book_fts_au') ORDER BY name",
        )
        .all();
    const oldFtsTriggers = ftsTriggers();
    expect(oldFtsTriggers.map(({ name }) => name)).toEqual([
      "hive_book_fts_ad",
      "hive_book_fts_ai",
      "hive_book_fts_au",
    ]);
    const search = (term: string) =>
      sqlite.query("SELECT rowid FROM hive_book_fts WHERE hive_book_fts MATCH ?").all(term);
    // Insert under the historical triggers, then update/delete after upgrading.
    await db
      .insertInto("hive_book")
      .values({
        id: "bk_upgradefts",
        title: "Upgradeftsoriginal",
        authors: "Author",
        source: "test",
        enrichAttempts: 0,
        thumbnail: "",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      })
      .execute();
    expect(search("Upgradeftsoriginal")).toHaveLength(1);

    expect(await migrateToLatest(db, sqlite)).toEqual([
      { migrationName: "033", direction: "Up", status: "Success" },
      { migrationName: "034", direction: "Up", status: "Success" },
    ]);
    expect(history().slice(0, 32)).toEqual(oldHistory);
    expect(history().slice(32)).toEqual([
      { name: "033", timestamp: expect.any(String) },
      { name: "034", timestamp: expect.any(String) },
    ]);
    expect(reverseIndex()).toEqual(oldIndex);
    expect(ftsTriggers()).toEqual(oldFtsTriggers);
    expect(search("Upgradeftsoriginal")).toHaveLength(1);
    await db
      .updateTable("hive_book")
      .set({ title: "Upgradeftsupdated" })
      .where("id", "=", "bk_upgradefts")
      .execute();
    expect(search("Upgradeftsoriginal")).toEqual([]);
    expect(search("Upgradeftsupdated")).toHaveLength(1);
    await db.deleteFrom("hive_book").where("id", "=", "bk_upgradefts").execute();
    expect(search("Upgradeftsupdated")).toEqual([]);
    expect(await db.selectFrom("user_book").selectAll().orderBy("uri").execute()).toEqual(books);
    expect(await db.selectFrom("user_follows").selectAll().orderBy("followsDid").execute()).toEqual(
      follows,
    );
    expect(await db.selectFrom("sync_write_queue").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("sync_write_state").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("follow_sync_state").selectAll().execute()).toEqual([]);
    expect(await migrateToLatest(db, sqlite)).toEqual([]);
  });

  it("imports persisted legacy progress once, keeps newer SQL and never resurrects acknowledged writes after restart", async () => {
    // Persist the pre-upgrade KV array before 033 even exists.
    await kv.setItem(KEY, [LEGACY, CONFLICT]);
    await kv.dispose();
    kv = openKv();
    expect(await kv.getItem(KEY)).toEqual([LEGACY, CONFLICT]);
    await migrateToLatest(connection.db, connection.sqlite);
    await enqueuePdsWrite(connection.db, DID, NEWER);
    const newerRow = await connection.db
      .selectFrom("sync_write_queue")
      .selectAll()
      .executeTakeFirstOrThrow();
    const written: PendingWrite[] = [];
    // A failed best-effort KV cleanup must not weaken the durable import marker.
    const remove = spyOn(kv, "removeItem").mockRejectedValue(new Error("cleanup unavailable"));
    try {
      expect(
        await drainSyncWrites({
          db: connection.db,
          kv,
          userDid: DID,
          write: async (entry, publication) => {
            written.push({ hiveId: entry.hiveId, bookProgress: entry.bookProgress });
            if (entry.hiveId === NEWER.hiveId) expect(publication.revision).toBe(newerRow.revision);
          },
        }),
      ).toMatchObject({ selected: 2, attempted: 2, failed: 0, remaining: 0 });
    } finally {
      remove.mockRestore();
    }
    expect(written.sort((a, b) => a.hiveId.localeCompare(b.hiveId))).toEqual([NEWER, LEGACY]);
    expect(await kv.getItem(KEY)).toEqual([LEGACY, CONFLICT]);
    expect(
      await connection.db.selectFrom("sync_write_state").selectAll().executeTakeFirstOrThrow(),
    ).toEqual({
      userDid: DID,
      legacyImported: 1,
      leaseToken: null,
      leaseUntil: null,
    });

    await connection.db.destroy();
    await kv.dispose();
    connection = createDb(join(root, "main.sqlite"));
    kv = openKv();
    expect(await migrateToLatest(connection.db, connection.sqlite)).toEqual([]);
    const read = spyOn(kv, "getItem");
    try {
      const write = async (entry: PendingWrite) => {
        written.push({ hiveId: entry.hiveId, bookProgress: entry.bookProgress });
      };
      expect(await drainSyncWrites({ db: connection.db, kv, userDid: DID, write })).toBeNull();
      expect(read).not.toHaveBeenCalled();
      // Even a new producer cannot cause the old array to be imported again.
      await enqueuePdsWrite(connection.db, DID, { ...LEGACY, bookProgress: '{"percent":75}' });
      expect(await drainSyncWrites({ db: connection.db, kv, userDid: DID, write })).toMatchObject({
        selected: 1,
        attempted: 1,
        remaining: 0,
      });
      expect(read).not.toHaveBeenCalled();
      expect(written).toHaveLength(3);
      expect(written[2]).toEqual({ ...LEGACY, bookProgress: '{"percent":75}' });
      expect(await connection.db.selectFrom("sync_write_queue").selectAll().execute()).toEqual([]);
    } finally {
      read.mockRestore();
    }
  });
});
