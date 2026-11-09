import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SessionClient } from "../auth/client";
import { ids } from "../bsky/lexicon/index";
import * as library from "../data/personalLibrary";
import { createTestDb, testKv } from "../test/db";
import { importLegacySyncWrites } from "../data/syncWriteQueue";
import { deleteAccountData } from "./deleteAccount";

const USER = `did:plc:delete-account-test-${process.pid}`;
const OTHER = `${USER}-other`;
const TABLES = [
  "personal_shelf_item",
  "personal_shelf",
  "personal_book",
  "sync_document",
  "book_list_item",
  "book_list",
  "buzz",
  "user_book",
  "user_follows",
  "progress_history",
  "sync_write_queue",
] as const;

describe("account deletion", () => {
  let fixture: Awaited<ReturnType<typeof createTestDb>>;
  let kv: ReturnType<typeof testKv>;
  const emptyPage = (): { ok: boolean; data: { records: { uri: string }[]; cursor?: string } } => ({
    ok: true,
    data: { records: [] },
  });
  const agentWith = (
    get = mock(async () => emptyPage()),
    post = mock(async () => ({ ok: true })),
  ) => ({ did: USER, get, post }) as unknown as SessionClient;
  const counts = () =>
    TABLES.map((table) => fixture.sqlite.query(`SELECT count(*) AS count FROM ${table}`).get());

  beforeEach(async () => {
    fixture = await createTestDb();
    kv = testKv();
    for (const did of [USER, OTHER]) {
      await kv.setItem(`sync_pending:${did}`, [
        { hiveId: "bk_test", bookProgress: '{"percent":42}' },
      ]);
      const sqlite = fixture.sqlite;
      sqlite
        .query(`INSERT INTO sync_write_queue (userDid, hiveId, revision, bookProgress, enqueuedAt)
        VALUES (?, 'bk_test', 'revision', '{}', '')`)
        .run(did);
      sqlite
        .query(
          `INSERT INTO personal_shelf (userDid, name, createdAt, updatedAt) VALUES (?, 'Shelf', '', '')`,
        )
        .run(did);
      sqlite
        .query(
          `INSERT INTO personal_book (userDid, contentHash, filename, title, format, mime, filePath, sizeBytes, createdAt, updatedAt) VALUES (?, 'hash', 'book.epub', 'Book', 'epub', 'application/epub+zip', '', 1, '', '')`,
        )
        .run(did);
      sqlite
        .query(
          `INSERT INTO personal_shelf_item (shelfId, personalBookId, createdAt) SELECT s.id, b.id, '' FROM personal_shelf s JOIN personal_book b ON s.userDid = b.userDid WHERE s.userDid = ?`,
        )
        .run(did);
      sqlite
        .query(
          `INSERT INTO sync_document (userDid, documentHash, progressData, createdAt, updatedAt) VALUES (?, 'hash', '{}', '', '')`,
        )
        .run(did);
      sqlite
        .query(
          `INSERT INTO book_list (uri, cid, userDid, name, createdAt, indexedAt) VALUES (?, 'cid', ?, 'List', '', '')`,
        )
        .run(`${did}/list`, did);
      sqlite
        .query(
          `INSERT INTO book_list_item (uri, cid, userDid, listUri, addedAt, indexedAt) VALUES (?, 'cid', ?, ?, '', '')`,
        )
        .run(`${did}/item`, did, `${did}/list`);
      sqlite
        .query(
          `INSERT INTO buzz (uri, cid, userDid, createdAt, indexedAt, comment, bookUri, bookCid, hiveId, parentUri, parentCid) VALUES (?, 'cid', ?, '', '', 'Review', '', '', 'bk_test', '', '')`,
        )
        .run(`${did}/buzz`, did);
      sqlite
        .query(
          `INSERT INTO user_book (uri, cid, userDid, createdAt, indexedAt, hiveId, title, authors) VALUES (?, 'cid', ?, '', '', 'bk_test', 'Book', 'Author')`,
        )
        .run(`${did}/book`, did);
      sqlite
        .query(
          `INSERT INTO user_follows (userDid, followsDid, followedAt, syncedAt, lastSeenAt, isActive) VALUES (?, 'did:plc:followed', '', '', '', 1)`,
        )
        .run(did);
      sqlite
        .query(
          `INSERT INTO progress_history (userDid, hiveId, percent, createdAt) VALUES (?, 'bk_test', 10, '')`,
        )
        .run(did);
    }
  });

  afterEach(async () => {
    mock.restore();
    await library.removeUserDir(USER);
    await kv.dispose();
    await fixture.close();
  });

  it("preserves every local table when a later collection scan fails", async () => {
    const get = mock(async () => emptyPage())
      .mockResolvedValueOnce(emptyPage())
      .mockResolvedValueOnce({ ok: false, data: { records: [] } });
    expect(deleteAccountData({ agent: agentWith(get), db: fixture.db, kv })).rejects.toThrow(
      "Failed to list",
    );
    expect(counts()).toEqual(TABLES.map(() => ({ count: 2 })));
    expect(await kv.hasItem(`sync_pending:${USER}`)).toBe(true);
    expect(await fixture.db.selectFrom("sync_write_state").selectAll().execute()).toEqual([]);
  });

  it("advances the follow generation without touching another user's fence", async () => {
    await fixture.db
      .insertInto("follow_sync_state")
      .values([
        { userDid: USER, revision: 4 },
        { userDid: OTHER, revision: 7 },
      ])
      .execute();
    await deleteAccountData({ agent: agentWith(), db: fixture.db, kv });
    await deleteAccountData({ agent: agentWith(), db: fixture.db, kv });
    expect(
      await fixture.db.selectFrom("follow_sync_state").selectAll().orderBy("userDid").execute(),
    ).toEqual([
      { userDid: USER, revision: 6 },
      { userDid: OTHER, revision: 7 },
    ]);
  });

  it("follows a short page's cursor before deleting its records", async () => {
    const get = mock(async () => emptyPage())
      .mockResolvedValueOnce({
        ok: true,
        data: {
          records: [{ uri: `at://${USER}/${ids.SocialPopfeedFeedListItem}/first` }],
          cursor: "next",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { records: [{ uri: `at://${USER}/${ids.SocialPopfeedFeedListItem}/second` }] },
      });
    const post = mock(async () => ({ ok: true }));
    await deleteAccountData({ agent: agentWith(get, post), db: fixture.db, kv });
    expect(get.mock.calls[1]).toMatchObject([
      "com.atproto.repo.listRecords",
      { params: { cursor: "next" } },
    ]);
    expect(post.mock.calls[0]).toMatchObject([
      "com.atproto.repo.applyWrites",
      { input: { writes: [{ rkey: "first" }, { rkey: "second" }] } },
    ]);
  });

  it("rejects cursor cycles without deleting local data or partial PDS results", async () => {
    const get = mock(async () => ({ ok: true, data: { records: [], cursor: "a" } }))
      .mockResolvedValueOnce({ ok: true, data: { records: [], cursor: "a" } })
      .mockResolvedValueOnce({ ok: true, data: { records: [], cursor: "b" } });
    const post = mock(async () => ({ ok: true }));
    expect(deleteAccountData({ agent: agentWith(get, post), db: fixture.db, kv })).rejects.toThrow(
      "Repeated cursor",
    );
    expect(get).toHaveBeenCalledTimes(3);
    expect(post).not.toHaveBeenCalled();
    expect(counts()).toEqual(TABLES.map(() => ({ count: 2 })));
  });

  it("bounds a scan to 500 pages and preserves local data", async () => {
    let page = 0;
    const get = mock(async () => ({ ok: true, data: { records: [], cursor: String(++page) } }));
    expect(deleteAccountData({ agent: agentWith(get), db: fixture.db, kv })).rejects.toThrow(
      "500 pages",
    );
    expect(get).toHaveBeenCalledTimes(500);
    expect(counts()).toEqual(TABLES.map(() => ({ count: 2 })));
  });

  it("cleans all local data including progress history after empty successful scans, preserving other users", async () => {
    const dir = path.join(library.getLibraryDir(), USER);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "book.epub"), "test ebook");
    const agent = agentWith();
    await deleteAccountData({ agent, db: fixture.db, kv });
    expect(counts()).toEqual(TABLES.map(() => ({ count: 1 })));
    expect(await Bun.file(path.join(dir, "book.epub")).exists()).toBe(false);
    expect(agent.post).not.toHaveBeenCalled();
    expect(await kv.getItem(`sync_pending:${USER}`)).toBeNull();
    expect(await kv.getItem(`sync_pending:${OTHER}`)).toEqual([
      { hiveId: "bk_test", bookProgress: '{"percent":42}' },
    ]);
    expect(
      await fixture.db
        .selectFrom("sync_write_state")
        .select("legacyImported")
        .where("userDid", "=", USER)
        .executeTakeFirst(),
    ).toEqual({ legacyImported: 1 });
    // Repeated cleanup succeeds even though both local records and files are gone.
    await deleteAccountData({ agent, db: fixture.db, kv });
    expect(counts()).toEqual(TABLES.map(() => ({ count: 1 })));
  });

  it("rolls back related local deletes if one delete fails", async () => {
    fixture.sqlite.exec(
      `CREATE TRIGGER prevent_progress_delete BEFORE DELETE ON progress_history BEGIN SELECT RAISE(ABORT, 'delete failed'); END`,
    );
    expect(deleteAccountData({ agent: agentWith(), db: fixture.db, kv })).rejects.toThrow(
      "delete failed",
    );
    expect(counts()).toEqual(TABLES.map(() => ({ count: 2 })));
    expect(await kv.hasItem(`sync_pending:${USER}`)).toBe(true);
    expect(await fixture.db.selectFrom("sync_write_state").selectAll().execute()).toEqual([]);
  });

  it("rejects failed legacy cleanup after committing the marker, prevents re-import, and retries removal", async () => {
    const key = `sync_pending:${USER}`;
    const remove = spyOn(kv, "removeItem").mockRejectedValueOnce(new Error("KV failure"));
    expect(deleteAccountData({ agent: agentWith(), db: fixture.db, kv })).rejects.toThrow(
      "KV failure",
    );
    expect(remove).toHaveBeenCalledWith(key);
    expect(counts()).toEqual(TABLES.map(() => ({ count: 1 })));
    expect(await kv.hasItem(key)).toBe(true);
    expect(
      await fixture.db
        .selectFrom("sync_write_state")
        .selectAll()
        .where("userDid", "=", USER)
        .executeTakeFirst(),
    ).toMatchObject({ legacyImported: 1 });

    // Even before the user retries account deletion, the retained legacy key is inert.
    await importLegacySyncWrites(fixture.db, kv, USER);
    expect(
      await fixture.db
        .selectFrom("sync_write_queue")
        .selectAll()
        .where("userDid", "=", USER)
        .execute(),
    ).toEqual([]);
    expect(await kv.hasItem(key)).toBe(true);

    await deleteAccountData({ agent: agentWith(), db: fixture.db, kv });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await kv.hasItem(key)).toBe(false);
    expect(await kv.hasItem(`sync_pending:${OTHER}`)).toBe(true);
  });

  it("propagates filesystem failure and lets a retry complete cleanup", async () => {
    const remove = spyOn(library, "removeUserDir").mockRejectedValueOnce(new Error("disk failure"));
    expect(deleteAccountData({ agent: agentWith(), db: fixture.db, kv })).rejects.toThrow(
      "disk failure",
    );
    expect(await kv.hasItem(`sync_pending:${USER}`)).toBe(false);
    remove.mockRestore();
    await deleteAccountData({ agent: agentWith(), db: fixture.db, kv });
    expect(counts()).toEqual(TABLES.map(() => ({ count: 1 })));
  });
});
