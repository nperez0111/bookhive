import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SessionClient } from "../auth/client";
import { ids } from "../bsky/lexicon/index";
import * as library from "../data/personalLibrary";
import { createTestDb } from "../test/db";
import { deleteAccountData } from "./deleteAccount";

const COLLECTIONS = [
  ids.SocialPopfeedFeedListItem,
  ids.SocialPopfeedFeedList,
  ids.BuzzBookhiveBuzz,
  ids.BuzzBookhiveBook,
];
const USER_TABLES = [
  "personal_shelf",
  "personal_book",
  "sync_document",
  "book_list_item",
  "book_list",
  "buzz",
  "user_book",
  "progress_history",
  "user_follows",
] as const;

async function expectFailure(operation: Promise<void>, message: string) {
  const failure = await operation.then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain(message);
}

describe("account deletion", () => {
  let database: Awaited<ReturnType<typeof createTestDb>>;
  let user: string;
  let other: string;
  let cleanupSpy: ReturnType<typeof spyOn<typeof library, "removeUserDir">> | undefined;

  const userDir = (did: string) => path.join(library.getLibraryDir(), did);
  const file = (did: string) => path.join(userDir(did), "book.epub");
  const agentWith = (
    get: ReturnType<typeof mock> = mock(async (_name: string, _options: unknown) => ({
      ok: true,
      data: { records: [] as { uri: string }[], cursor: undefined as string | undefined },
    })),
    post: ReturnType<typeof mock> = mock(async (_name: string, _options: unknown) => ({
      ok: true,
    })),
  ) => ({ did: user, get, post }) as unknown as SessionClient;

  beforeEach(async () => {
    database = await createTestDb();
    user = `did:plc:delete-test-${randomUUID()}`;
    other = `did:plc:keep-test-${randomUUID()}`;
    // Use real migrated tables and isolated user directories, not global module mocks.
    for (const did of [user, other]) {
      await mkdir(userDir(did), { recursive: true });
      await writeFile(file(did), "ebook");
      const insert = (query: string, ...values: (string | number)[]) =>
        database.sqlite.query(query).run(...values);
      insert(
        `INSERT INTO personal_book (userDid, contentHash, filename, title, format, mime,
          filePath, sizeBytes, createdAt, updatedAt) VALUES (?, 'hash', 'book.epub', 'Book',
          'epub', 'application/epub+zip', ?, 5, 'now', 'now')`,
        did,
        file(did),
      );
      insert(
        `INSERT INTO personal_shelf (userDid, name, createdAt, updatedAt)
          VALUES (?, 'Shelf', 'now', 'now')`,
        did,
      );
      insert(
        `INSERT INTO personal_shelf_item (shelfId, personalBookId, createdAt)
          SELECT s.id, b.id, 'now' FROM personal_shelf s JOIN personal_book b
          ON s.userDid = b.userDid WHERE s.userDid = ?`,
        did,
      );
      insert(
        `INSERT INTO sync_document (userDid, documentHash, progressData, createdAt, updatedAt)
          VALUES (?, 'hash', '{}', 'now', 'now')`,
        did,
      );
      insert(
        `INSERT INTO book_list (uri, cid, userDid, name, createdAt, indexedAt)
          VALUES (?, 'cid', ?, 'Shelf', 'now', 'now')`,
        `at://${did}/${ids.SocialPopfeedFeedList}/list`,
        did,
      );
      insert(
        `INSERT INTO book_list_item (uri, cid, userDid, listUri, addedAt, indexedAt)
          VALUES (?, 'cid', ?, ?, 'now', 'now')`,
        `at://${did}/${ids.SocialPopfeedFeedListItem}/item`,
        did,
        `at://${did}/${ids.SocialPopfeedFeedList}/list`,
      );
      insert(
        `INSERT INTO buzz (uri, cid, userDid, createdAt, indexedAt, comment, bookUri,
          bookCid, hiveId, parentUri, parentCid)
          VALUES (?, 'cid', ?, 'now', 'now', 'hello', '', '', 'bk_test', '', '')`,
        `at://${did}/${ids.BuzzBookhiveBuzz}/buzz`,
        did,
      );
      insert(
        `INSERT INTO user_book (uri, cid, userDid, createdAt, indexedAt, hiveId, title, authors)
          VALUES (?, 'cid', ?, 'now', 'now', 'bk_test', 'Book', 'Author')`,
        `at://${did}/${ids.BuzzBookhiveBook}/book`,
        did,
      );
      insert(
        `INSERT INTO progress_history (userDid, hiveId, percent, createdAt)
          VALUES (?, 'bk_test', 50, 'now')`,
        did,
      );
      insert(
        `INSERT INTO user_follows (userDid, followsDid, followedAt, syncedAt, lastSeenAt)
          VALUES (?, ?, 'now', 'now', 'now')`,
        did,
        did === user ? other : user,
      );
    }
  });

  afterEach(async () => {
    cleanupSpy?.mockRestore();
    cleanupSpy = undefined;
    await database.close();
    await Promise.all(
      [user, other].map((did) => rm(userDir(did), { recursive: true, force: true })),
    );
  });

  async function expectRows(did: string, count: number) {
    for (const table of USER_TABLES) {
      expect(
        await database.db.selectFrom(table).selectAll().where("userDid", "=", did).execute(),
      ).toHaveLength(count);
    }
    const items = await database.db
      .selectFrom("personal_shelf_item")
      .innerJoin("personal_shelf", "personal_shelf.id", "personal_shelf_item.shelfId")
      .where("personal_shelf.userDid", "=", did)
      .select("personal_shelf_item.id")
      .execute();
    expect(items).toHaveLength(count);
  }

  it("removes only the user's rows/files, including history, and can be retried", async () => {
    const agent = agentWith();
    await deleteAccountData({ db: database.db, agent });
    await expectRows(user, 0);
    await expectRows(other, 1);
    expect(await Bun.file(file(user)).exists()).toBe(false);
    expect(await Bun.file(file(other)).text()).toBe("ebook");
    expect(await database.db.selectFrom("personal_shelf_item").selectAll().execute()).toHaveLength(
      1,
    );
    await deleteAccountData({ db: database.db, agent });
    await expectRows(other, 1);
  });

  it("rejects a failed later list page without deleting a partial collection or local data", async () => {
    const get = mock()
      .mockResolvedValueOnce({
        ok: true,
        data: { records: [{ uri: `at://${user}/${COLLECTIONS[0]}/one` }], cursor: "next" },
      })
      .mockResolvedValueOnce({ ok: false });
    const post = mock();
    await expectFailure(
      deleteAccountData({ db: database.db, agent: agentWith(get, post) }),
      `Failed to list ${COLLECTIONS[0]} records from PDS`,
    );
    expect(get).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
    await expectRows(user, 1);
    expect(await Bun.file(file(user)).text()).toBe("ebook");
  });

  it("follows cursors, batches at 200, and touches only BookHive collections in child-first order", async () => {
    const records = (collection: string, start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ uri: `at://${user}/${collection}/${start + i}` }));
    const get = mock()
      .mockResolvedValueOnce({
        ok: true,
        data: { records: records(COLLECTIONS[0]!, 0, 100), cursor: "a" },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { records: records(COLLECTIONS[0]!, 100, 100), cursor: "b" },
      })
      .mockResolvedValueOnce({ ok: true, data: { records: records(COLLECTIONS[0]!, 200, 1) } });
    for (const collection of COLLECTIONS.slice(1)) {
      get.mockResolvedValueOnce({ ok: true, data: { records: records(collection, 0, 1) } });
    }
    const post = mock(async (_name: string, _options: unknown) => ({ ok: true }));
    await deleteAccountData({ db: database.db, agent: agentWith(get, post) });
    expect(get.mock.calls.map((call) => call[1].params.collection)).toEqual([
      COLLECTIONS[0],
      COLLECTIONS[0],
      ...COLLECTIONS,
    ]);
    expect(
      post.mock.calls.map(
        (call) => (call[1] as { input: { writes: unknown[] } }).input.writes.length,
      ),
    ).toEqual([200, 1, 1, 1, 1]);
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      input: {
        repo: user,
        writes: expect.arrayContaining([
          { $type: "com.atproto.repo.applyWrites#delete", collection: COLLECTIONS[0], rkey: "0" },
        ]),
      },
    });
  });

  it("rejects a refused PDS deletion before local cleanup", async () => {
    const get = mock(async () => ({
      ok: true,
      data: { records: [{ uri: `at://${user}/${COLLECTIONS[0]}/one` }] },
    }));
    const post = mock(async () => ({ ok: false }));
    await expectFailure(
      deleteAccountData({ db: database.db, agent: agentWith(get, post) }),
      "Failed to delete",
    );
    await expectRows(user, 1);
    expect(await Bun.file(file(user)).exists()).toBe(true);
  });

  it("rolls back every local deletion if a late delete fails, leaving files intact", async () => {
    database.sqlite.exec(`CREATE TRIGGER fail_account_delete BEFORE DELETE ON user_follows
      BEGIN SELECT RAISE(ABORT, 'injected local failure'); END`);
    await expectFailure(
      deleteAccountData({ db: database.db, agent: agentWith() }),
      "injected local failure",
    );
    await expectRows(user, 1);
    await expectRows(other, 1);
    expect(await Bun.file(file(user)).exists()).toBe(true);
  });

  it("reports file cleanup failure after committing rows and permits cleanup on retry", async () => {
    cleanupSpy = spyOn(library, "removeUserDir").mockRejectedValueOnce(
      new Error("disk unavailable"),
    );
    await expectFailure(
      deleteAccountData({ db: database.db, agent: agentWith() }),
      "disk unavailable",
    );
    await expectRows(user, 0);
    await expectRows(other, 1);
    expect(await Bun.file(file(user)).exists()).toBe(true);
    cleanupSpy.mockRestore();
    cleanupSpy = undefined;
    await deleteAccountData({ db: database.db, agent: agentWith() });
    expect(await Bun.file(file(user)).exists()).toBe(false);
    expect(await Bun.file(file(other)).text()).toBe("ebook");
  });
});
