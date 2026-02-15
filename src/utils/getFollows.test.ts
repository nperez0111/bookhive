import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { AppContext } from "../context";
import type { FollowsSync } from "./getFollows";

const { shouldSyncFollows, getUserFollows } = await import("./getFollows");

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
      const recentTime = new Date(
        Date.now() - 3 * 60 * 60 * 1000,
      ).toISOString();
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
      expect(mockWhere1).toHaveBeenCalledWith(
        "userDid",
        "=",
        "did:plc:test123",
      );
      expect(mockWhere2).toHaveBeenCalledWith("isActive", "=", 1);
      expect(mockOrderBy).toHaveBeenCalledWith("syncedAt", "desc");
      expect(mockLimit).toHaveBeenCalledWith(100);

      expect(result).toEqual([
        "did:plc:follow1",
        "did:plc:follow2",
        "did:plc:follow3",
      ]);
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
