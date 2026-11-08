import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Database as DatabaseSync } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import type { AppContext } from "../context";
import type { SessionClient } from "../auth/client";
import { createTestDb, testContext } from "../test/db";
import { wrapBunSqliteForKysely } from "../bun-sqlite-kysely";
import { migrateToLatest, type DatabaseSchema } from "../db";
import type { FollowsSync } from "./getFollows";
import { followUser, unfollowUser } from "./followGraph";

const { shouldSyncFollows, getUserFollows, syncUserFollows } = await import("./getFollows");

// Mock KV storage
const mockKv = {
  get: mock(),
  set: mock(),
};

// Mock database
const mockDb = {
  selectFrom: mock(() => ({
    select: mock(() => ({
      where: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => ({
              execute: mock(),
            })),
          })),
        })),
      })),
    })),
  })),
};

const mockCtx: AppContext = {
  kv: mockKv as any,
  db: mockDb as any,
  addWideEventContext: mock(),
} as any;

describe("getFollows utilities", () => {
  beforeEach(() => {
    mockKv.get.mockClear();
    mockKv.set.mockClear();
    mockDb.selectFrom.mockClear();
  });

  describe("shouldSyncFollows", () => {
    it("should return true when no previous sync data exists", async () => {
      mockKv.get.mockResolvedValueOnce(null);

      const result = await shouldSyncFollows(mockCtx, "did:plc:test123");

      expect(result).toBe(true);
      expect(mockKv.get).toHaveBeenCalledWith("follows_sync:did:plc:test123");
    });

    it("should return true when no lastIncrementalSync exists", async () => {
      const syncData: FollowsSync = {
        userDid: "did:plc:test123",
        lastFullSync: "2025-08-01T10:00:00.000Z",
        lastIncrementalSync: null,
        cursor: null,
      };
      mockKv.get.mockResolvedValueOnce(syncData);

      const result = await shouldSyncFollows(mockCtx, "did:plc:test123");

      expect(result).toBe(true);
    });

    it("should return false when last sync was recent (< 6 hours)", async () => {
      const recentTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const syncData: FollowsSync = {
        userDid: "did:plc:test123",
        lastFullSync: "2025-08-01T10:00:00.000Z",
        lastIncrementalSync: recentTime,
        cursor: null,
      };
      mockKv.get.mockResolvedValueOnce(syncData);

      const result = await shouldSyncFollows(mockCtx, "did:plc:test123");

      expect(result).toBe(false);
    });

    it("should return true when last sync was old (> 6 hours)", async () => {
      const oldTime = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
      const syncData: FollowsSync = {
        userDid: "did:plc:test123",
        lastFullSync: "2025-08-01T10:00:00.000Z",
        lastIncrementalSync: oldTime,
        cursor: null,
      };
      mockKv.get.mockResolvedValueOnce(syncData);

      const result = await shouldSyncFollows(mockCtx, "did:plc:test123");

      expect(result).toBe(true);
    });

    it("should return true on KV error (fail safe)", async () => {
      mockKv.get.mockRejectedValueOnce(new Error("KV error"));

      const result = await shouldSyncFollows(mockCtx, "did:plc:test123");

      expect(result).toBe(true);
    });
  });

  describe("getUserFollows", () => {
    it("should query database with correct parameters and return follow DIDs", async () => {
      const mockFollows = [
        { followsDid: "did:plc:follow1" },
        { followsDid: "did:plc:follow2" },
        { followsDid: "did:plc:follow3" },
      ];

      const mockExecute = mock().mockResolvedValueOnce(mockFollows);
      const mockLimit = mock(() => ({ execute: mockExecute }));
      const mockOrderBy = mock(() => ({ limit: mockLimit }));
      const mockWhere2 = mock(() => ({ orderBy: mockOrderBy }));
      const mockWhere1 = mock(() => ({ where: mockWhere2 }));
      const mockSelect = mock(() => ({ where: mockWhere1 }));
      mockDb.selectFrom.mockReturnValueOnce({ select: mockSelect });

      const result = await getUserFollows(mockCtx, "did:plc:test123", 100);

      expect(mockDb.selectFrom).toHaveBeenCalledWith("user_follows");
      expect(mockSelect).toHaveBeenCalledWith("followsDid");
      expect(mockWhere1).toHaveBeenCalledWith("userDid", "=", "did:plc:test123");
      expect(mockWhere2).toHaveBeenCalledWith("isActive", "=", 1);
      expect(mockOrderBy).toHaveBeenCalledWith("syncedAt", "desc");
      expect(mockLimit).toHaveBeenCalledWith(100);

      expect(result).toEqual(["did:plc:follow1", "did:plc:follow2", "did:plc:follow3"]);
    });

    it("should return empty array when no follows found", async () => {
      const mockExecute = mock().mockResolvedValueOnce([]);
      const mockLimit = mock(() => ({ execute: mockExecute }));
      const mockOrderBy = mock(() => ({ limit: mockLimit }));
      const mockWhere2 = mock(() => ({ orderBy: mockOrderBy }));
      const mockWhere1 = mock(() => ({ where: mockWhere2 }));
      const mockSelect = mock(() => ({ where: mockWhere1 }));
      mockDb.selectFrom.mockReturnValueOnce({ select: mockSelect });

      const result = await getUserFollows(mockCtx, "did:plc:test123");

      expect(result).toEqual([]);
    });
  });
});

describe("follow sync completion and atomicity", () => {
  const userDid = "did:plc:reader";
  const oldTime = "2026-01-01T00:00:00.000Z";
  let fixture: Awaited<ReturnType<typeof createTestDb>>;
  let ctx: AppContext;
  let metadata: FollowsSync | null;
  let set: ReturnType<typeof mock>;

  beforeEach(async () => {
    fixture = await createTestDb();
    metadata = null;
    set = mock(async (_key: string, value: FollowsSync) => {
      metadata = value;
    });
    ctx = {
      db: fixture.db,
      kv: { get: mock(async () => metadata), set },
      addWideEventContext: mock(),
    } as unknown as AppContext;
    await seed("old", 1);
    await seed("inactive", 0);
  });
  afterEach(async () => fixture.close());

  async function seed(did: string, isActive: 0 | 1) {
    await fixture.db
      .insertInto("user_follows")
      .values({
        userDid,
        followsDid: did,
        isActive,
        followedAt: oldTime,
        syncedAt: oldTime,
        lastSeenAt: oldTime,
      })
      .execute();
  }
  const rows = () =>
    fixture.db
      .selectFrom("user_follows")
      .selectAll()
      .where("userDid", "=", userDid)
      .orderBy("followsDid")
      .execute();
  const page = (dids: readonly string[], cursor?: string) => ({
    ok: true,
    data: { follows: dids.map((did) => ({ did })), cursor },
  });
  const agent = (get: ReturnType<typeof mock>) =>
    ({ did: userDid, get }) as unknown as SessionClient;
  function incremental() {
    metadata = {
      userDid,
      lastFullSync: new Date().toISOString(),
      lastIncrementalSync: oldTime,
      cursor: null,
    };
  }

  for (const mode of ["full", "incremental"]) {
    for (const failure of ["nonOK", "throw", "cycle", "empty cursor", "page cap"]) {
      it(`${mode}: ${failure} preserves rows and freshness`, async () => {
        if (mode === "incremental") incremental();
        const before = await rows();
        const beforeMetadata = metadata;
        let calls = 0;
        const get = mock(async () => {
          calls++;
          if (failure === "page cap") return page([`new${calls}`], `c${calls}`);
          if (calls === 1) return page(["new"], "next");
          if (failure === "throw") throw new Error("offline");
          if (failure === "nonOK") return { ok: false, data: {} };
          if (failure === "empty cursor") return page([], "another");
          return page(["new2"], "next");
        });
        const result = await syncUserFollows(ctx, agent(get)).catch((error: unknown) => error);
        expect(result).toBeInstanceOf(Error);
        expect(await rows()).toEqual(before);
        expect(metadata).toEqual(beforeMetadata);
        expect(set).not.toHaveBeenCalled();
        if (failure === "page cap") expect(get).toHaveBeenCalledTimes(500);
      });
    }
  }

  it("follows a short page's cursor and commits only after exhaustion", async () => {
    let calls = 0;
    const before = await rows();
    const get = mock(async () => {
      expect(await rows()).toEqual(before);
      return ++calls === 1 ? page(["new"], "next") : page(["inactive"]);
    });
    await syncUserFollows(ctx, agent(get));
    expect(get).toHaveBeenCalledTimes(2);
    expect((await rows()).map((r) => [r.followsDid, r.isActive])).toEqual([
      ["inactive", 1],
      ["new", 1],
    ]);
    expect((await rows()).find((row) => row.followsDid === "inactive")?.syncedAt).toBe(oldTime);
    expect(metadata?.lastFullSync).toBeTruthy();
    expect(await shouldSyncFollows(ctx, userDid)).toBe(false);
  });

  it("accepts a terminal empty page and prunes only this user", async () => {
    await fixture.db
      .insertInto("user_follows")
      .values({
        userDid: "other",
        followsDid: "old",
        isActive: 1,
        followedAt: oldTime,
        syncedAt: oldTime,
        lastSeenAt: oldTime,
      })
      .execute();
    await syncUserFollows(ctx, agent(mock(async () => page([]))));
    expect(await rows()).toEqual([]);
    expect(
      await fixture.db
        .selectFrom("user_follows")
        .selectAll()
        .where("userDid", "=", "other")
        .execute(),
    ).toHaveLength(1);
  });

  it.each(["full", "incremental"])("%s: completes more than 10 short pages", async (mode) => {
    if (mode === "incremental") incremental();
    const before = await rows();
    let calls = 0;
    const get = mock(async () => {
      expect(await rows()).toEqual(before);
      calls++;
      return page([`new${calls}`], calls < 11 ? `c${calls}` : undefined);
    });
    await syncUserFollows(ctx, agent(get));
    expect(get).toHaveBeenCalledTimes(11);
    expect(await rows()).toHaveLength(mode === "full" ? 11 : 13);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("rejects a multi-page cursor cycle without committing staged follows", async () => {
    const before = await rows();
    const get = mock()
      .mockResolvedValueOnce(page(["new1"], "a"))
      .mockResolvedValueOnce(page(["new2"], "b"))
      .mockResolvedValueOnce(page(["new3"], "a"));
    const result = await syncUserFollows(ctx, agent(get)).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(get).toHaveBeenCalledTimes(3);
    expect(await rows()).toEqual(before);
    expect(set).not.toHaveBeenCalled();
  });

  it("accepts exactly 1000 follows when the final page has no cursor", async () => {
    let calls = 0;
    const get = mock(async () => {
      calls++;
      return page(
        Array.from({ length: 100 }, (_, i) => `new${calls}-${i}`),
        calls < 10 ? `c${calls}` : undefined,
      );
    });
    await syncUserFollows(ctx, agent(get));
    expect(await rows()).toHaveLength(1000);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("completes a 1001-follow full scan before pruning or advancing freshness", async () => {
    const before = await rows();
    let calls = 0;
    const get = mock(async (_method: string, { params }: { params: { cursor?: string } }) => {
      expect(params.cursor).toBe(calls === 0 ? undefined : `c${calls}`);
      expect(await rows()).toEqual(before);
      expect(set).not.toHaveBeenCalled();
      calls++;
      return calls <= 10
        ? page(
            Array.from({ length: 100 }, (_, i) => `new${calls}-${i}`),
            `c${calls}`,
          )
        : page(["last-follow"]);
    });
    await syncUserFollows(ctx, agent(get));
    expect(get).toHaveBeenCalledTimes(11);
    const stored = await rows();
    expect(stored).toHaveLength(1001);
    expect(stored.every((follow) => follow.isActive === 1)).toBe(true);
    expect(stored.some((follow) => follow.followsDid === "last-follow")).toBe(true);
    expect(stored.some((follow) => ["old", "inactive"].includes(follow.followsDid))).toBe(false);
    expect(set).toHaveBeenCalledTimes(1);
    expect(metadata?.lastFullSync).toBeTruthy();
    expect(await shouldSyncFollows(ctx, userDid)).toBe(false);
  });

  it("incremental scan reactivates inactive rows and stops before the first active follow", async () => {
    incremental();
    const get = mock()
      .mockResolvedValueOnce(page(["inactive"], "next"))
      .mockResolvedValueOnce(page(["new", "old", "after-boundary"], "unused"));
    await syncUserFollows(ctx, agent(get));
    expect(get).toHaveBeenCalledTimes(2);
    expect((await rows()).map((r) => [r.followsDid, r.isActive])).toEqual([
      ["inactive", 1],
      ["new", 1],
      ["old", 1],
    ]);
    const stored = await rows();
    expect(stored.find((row) => row.followsDid === "inactive")?.syncedAt).toBe(oldTime);
    expect(stored.find((row) => row.followsDid === "old")?.lastSeenAt).toBe(oldTime);
    expect(metadata?.lastIncrementalSync).not.toBe(oldTime);
  });

  it("rolls back stale marking when the commit fails and does not mark fresh", async () => {
    const before = await rows();
    fixture.sqlite.exec(`CREATE TRIGGER reject_follow_insert BEFORE INSERT ON user_follows
      BEGIN SELECT RAISE(ABORT, 'test commit failure'); END`);
    const result = await syncUserFollows(ctx, agent(mock(async () => page(["new"])))).catch(
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect(await rows()).toEqual(before);
    expect(set).not.toHaveBeenCalled();
    expect(await fixture.db.selectFrom("follow_sync_state").selectAll().execute()).toEqual([]);
  });

  for (const mode of ["full", "incremental"]) {
    for (const action of ["follow", "unfollow"]) {
      it(`${mode}: an acknowledged ${action} during traversal fences publication`, async () => {
        if (mode === "incremental") incremental();
        const beforeMetadata = metadata;
        const targetDid = action === "follow" ? "new" : "inactive";
        const writeAgent = {
          did: userDid,
          get: mock(async () => ({
            ok: true,
            data: {
              records: [
                {
                  uri: `at://${userDid}/app.bsky.graph.follow/record`,
                  value: { subject: targetDid },
                },
              ],
            },
          })),
          post: mock(async () => ({
            ok: true,
            data: { results: [{ $type: "com.atproto.repo.applyWrites#createResult" }] },
          })),
        } as unknown as SessionClient;
        const scan = agent(
          mock(async () => {
            const mutate = action === "follow" ? followUser : unfollowUser;
            expect(await mutate({ db: fixture.db, agent: writeAgent, targetDid })).toEqual({
              ok: true,
            });
            // This response was captured before the acknowledged interactive write.
            return page(action === "follow" ? [] : [targetDid]);
          }),
        );
        const result = await syncUserFollows(ctx, scan).catch((error: unknown) => error);
        expect(result).toMatchObject({ message: expect.stringContaining("changed during scan") });
        const stored = await rows();
        expect(stored.find((row) => row.followsDid === targetDid)?.isActive).toBe(
          action === "follow" ? 1 : 0,
        );
        expect(stored.find((row) => row.followsDid === "old")?.isActive).toBe(1);
        expect(metadata).toEqual(beforeMetadata);
        expect(set).not.toHaveBeenCalled();
        expect(writeAgent.post).toHaveBeenCalledTimes(1);
      });
    }
  }

  it.each([{ newerDids: [] }, { newerDids: ["newer"] }])(
    "fences an older scan after a newer snapshot commits: %j",
    async ({ newerDids }) => {
      await fixture.db.deleteFrom("user_follows").execute();
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const older = syncUserFollows(
        ctx,
        agent(
          mock(async () => {
            entered();
            await pending;
            return page(["older"]);
          }),
        ),
      );
      // Attach the rejection observer before releasing the older scan.
      const rejected = older.catch((error: unknown) => error);
      try {
        await Promise.race([
          started,
          older.then(() => {
            throw new Error("Older scan ended before entering the remote request");
          }),
        ]);
        await syncUserFollows(ctx, agent(mock(async () => page(newerDids))));
      } finally {
        release();
      }
      expect(await rejected).toMatchObject({
        message: expect.stringContaining("changed during scan"),
      });
      expect((await rows()).map((row) => row.followsDid)).toEqual([...newerDids]);
      expect(set).toHaveBeenCalledTimes(1);
      expect(
        (await fixture.db.selectFrom("follow_sync_state").selectAll().executeTakeFirstOrThrow())
          .revision,
      ).toBe(1);
    },
  );

  it("observes the interactive mutation fence through an independent SQLite connection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bookhive-follow-sync-"));
    const sqlite = new DatabaseSync(`${directory}/db.sqlite`);
    sqlite.exec("PRAGMA journal_mode = WAL");
    const scanDb = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: wrapBunSqliteForKysely(sqlite) }),
    });
    const writeDb = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({
        database: wrapBunSqliteForKysely(new DatabaseSync(`${directory}/db.sqlite`)),
      }),
    });
    try {
      await migrateToLatest(scanDb, sqlite);
      const scanCtx = testContext({ db: scanDb });
      const writer = {
        did: userDid,
        post: mock(async () => ({
          ok: true,
          data: { results: [{ $type: "com.atproto.repo.applyWrites#createResult" }] },
        })),
      } as unknown as SessionClient;
      const scan = agent(
        mock(async () => {
          expect(await followUser({ db: writeDb, agent: writer, targetDid: "new" })).toEqual({
            ok: true,
          });
          return page([]);
        }),
      );
      const result = await syncUserFollows(scanCtx, scan).catch((error: unknown) => error);
      expect(result).toMatchObject({ message: expect.stringContaining("changed during scan") });
      expect(
        await scanDb.selectFrom("user_follows").select(["followsDid", "isActive"]).execute(),
      ).toEqual([{ followsDid: "new", isActive: 1 }]);
      expect(await scanCtx.kv.get(`follows_sync:${userDid}`)).toBeNull();
    } finally {
      await scanDb.destroy();
      await writeDb.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    null,
    {},
    { follows: null },
    { follows: [null] },
    { follows: [{ did: null }] },
    { follows: [{ did: "" }] },
    { follows: [{ did: "new", createdAt: 123 }] },
    { follows: [], cursor: null },
    { follows: [], cursor: "" },
    { follows: [], cursor: 123 },
  ])("rejects malformed follow pagination without mutation: %j", async (data) => {
    const before = await rows();
    const result = await syncUserFollows(ctx, agent(mock(async () => ({ ok: true, data })))).catch(
      (error: unknown) => error,
    );
    expect(result).toMatchObject({ message: expect.stringContaining("malformed pagination") });
    expect(await rows()).toEqual(before);
    expect(set).not.toHaveBeenCalled();
    expect(await fixture.db.selectFrom("follow_sync_state").selectAll().execute()).toEqual([]);
  });
});
