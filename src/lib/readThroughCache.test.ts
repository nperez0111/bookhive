import { describe, it, expect, mock } from "bun:test";
import { readThroughCache, type ReadThroughCacheOptions } from "./readThroughCache";
import type { Storage, StorageMeta } from "unstorage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal in-memory Storage that tracks get/set/getMeta/setMeta. */
function createMockStorage(initial?: { value?: unknown; meta?: StorageMeta }) {
  let storedValue: unknown = initial?.value ?? null;
  let storedMeta: StorageMeta = initial?.meta ?? {};

  const storage = {
    get: mock(async () => storedValue),
    getMeta: mock(async () => storedMeta),
    set: mock(async (_key: string, value: unknown) => {
      storedValue = value;
    }),
    setMeta: mock(async (_key: string, meta: StorageMeta) => {
      storedMeta = meta;
    }),
    // Expose internals for assertions
    _getValue: () => storedValue,
    _getMeta: () => storedMeta,
  } as unknown as Storage<string> & {
    _getValue: () => unknown;
    _getMeta: () => StorageMeta;
  };
  return storage;
}

/** Helper to call readThroughCache with less boilerplate. */
async function cacheGet(
  kv: Storage<string>,
  key: string,
  fetcher: () => Promise<string>,
  defaultValue?: string,
  options?: ReadThroughCacheOptions,
) {
  return readThroughCache<string>(kv, key, () => fetcher(), defaultValue, options);
}

/** Flush microtasks + short timers so background revalidation can complete. */
function flushBackground(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readThroughCache", () => {
  // ------ Basic behavior (no SWR) ------

  describe("basic (no SWR)", () => {
    it("fetches and caches on a cold miss", async () => {
      const kv = createMockStorage();
      const fetcher = mock(async () => "fresh-value");

      const result = await cacheGet(kv, "k1", fetcher);

      expect(result).toBe("fresh-value");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(kv.set).toHaveBeenCalledWith("k1", "fresh-value");
    });

    it("returns cached value when within TTL", async () => {
      const kv = createMockStorage({
        value: "cached-value",
        meta: { timestamp: Date.now() - 1000 }, // 1s old
      });
      const fetcher = mock(async () => "fresh-value");

      const result = await cacheGet(kv, "k1", fetcher, undefined, { ttl: 60_000 });

      expect(result).toBe("cached-value");
      expect(fetcher).toHaveBeenCalledTimes(0);
    });

    it("re-fetches when TTL is expired", async () => {
      const kv = createMockStorage({
        value: "stale-value",
        meta: { timestamp: Date.now() - 120_000 }, // 2 min old
      });
      const fetcher = mock(async () => "fresh-value");

      const result = await cacheGet(kv, "k1", fetcher, undefined, { ttl: 60_000 });

      expect(result).toBe("fresh-value");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("returns defaultValue when fetch fails", async () => {
      const kv = createMockStorage();
      const fetcher = mock(async () => {
        throw new Error("network error");
      });

      const result = await cacheGet(kv, "k1", fetcher, "fallback");

      expect(result).toBe("fallback");
    });

    it("treats missing timestamp as expired", async () => {
      const kv = createMockStorage({
        value: "cached-value",
        meta: {}, // no timestamp
      });
      const fetcher = mock(async () => "fresh-value");

      const result = await cacheGet(kv, "k1", fetcher);

      expect(result).toBe("fresh-value");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("treats null meta as expired", async () => {
      // getMeta returns null-ish when no metadata exists
      const kv = createMockStorage({ value: "cached-value" });
      (kv.getMeta as ReturnType<typeof mock>).mockImplementation(async () => null);
      const fetcher = mock(async () => "fresh-value");

      const result = await cacheGet(kv, "k1", fetcher);

      expect(result).toBe("fresh-value");
    });
  });

  // ------ Deduplication ------

  describe("request deduplication", () => {
    it("deduplicates concurrent requests for the same key", async () => {
      const kv = createMockStorage();
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 50));
        return "value";
      };

      const [r1, r2, r3] = await Promise.all([
        cacheGet(kv, "same-key", fetcher),
        cacheGet(kv, "same-key", fetcher),
        cacheGet(kv, "same-key", fetcher),
      ]);

      expect(r1).toBe("value");
      expect(r2).toBe("value");
      expect(r3).toBe("value");
      expect(fetchCount).toBe(1);
    });
  });

  // ------ Stale-While-Revalidate ------

  describe("stale-while-revalidate", () => {
    const SWR_OPTIONS: ReadThroughCacheOptions = {
      revalidateAfter: 1000, // 1s
      ttl: 10_000, // 10s
    };

    it("returns cached value without fetching when within revalidateAfter window", async () => {
      const kv = createMockStorage({
        value: "fresh-cached",
        meta: { timestamp: Date.now() - 500 }, // 500ms old, within 1s revalidateAfter
      });
      const fetcher = mock(async () => "new-value");

      const result = await cacheGet(kv, "k1", fetcher, undefined, SWR_OPTIONS);

      expect(result).toBe("fresh-cached");
      expect(fetcher).toHaveBeenCalledTimes(0);
    });

    it("returns stale value immediately and triggers background revalidation", async () => {
      const kv = createMockStorage({
        value: "stale-cached",
        meta: { timestamp: Date.now() - 5000 }, // 5s old: past revalidateAfter (1s), within ttl (10s)
      });
      const fetcher = mock(async () => "bg-fresh");

      const result = await cacheGet(kv, "swr-key", fetcher, undefined, SWR_OPTIONS);

      // Should return stale immediately
      expect(result).toBe("stale-cached");

      // Background fetch should have been triggered
      await flushBackground();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Cache should now be updated with fresh value
      expect(kv._getValue()).toBe("bg-fresh");
    });

    it("blocks on fetch when age exceeds ttl (fully expired)", async () => {
      const kv = createMockStorage({
        value: "expired-value",
        meta: { timestamp: Date.now() - 20_000 }, // 20s old, past ttl of 10s
      });
      const fetcher = mock(async () => "fresh-value");

      const result = await cacheGet(kv, "k1", fetcher, undefined, SWR_OPTIONS);

      expect(result).toBe("fresh-value");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("blocks on fetch when cache is empty (miss)", async () => {
      const kv = createMockStorage(); // no cached value
      const fetcher = mock(async () => "fetched");

      const result = await cacheGet(kv, "k1", fetcher, undefined, SWR_OPTIONS);

      expect(result).toBe("fetched");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent background revalidations for the same key", async () => {
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 50));
        return "bg-value";
      };

      // Two concurrent SWR calls for the same stale key
      const kv1 = createMockStorage({
        value: "stale",
        meta: { timestamp: Date.now() - 5000 },
      });

      // First call triggers background revalidation
      const r1 = await cacheGet(kv1, "dedup-bg", fetcher, undefined, SWR_OPTIONS);
      // Second call should reuse the in-flight background promise
      const r2 = await cacheGet(kv1, "dedup-bg", fetcher, undefined, SWR_OPTIONS);

      expect(r1).toBe("stale");
      expect(r2).toBe("stale");

      await flushBackground();
      // Only one background fetch should have fired
      expect(fetchCount).toBe(1);
    });

    it("preserves stale data when background revalidation fails", async () => {
      const kv = createMockStorage({
        value: "stale-preserved",
        meta: { timestamp: Date.now() - 5000 },
      });
      const fetcher = mock(async () => {
        throw new Error("bg fetch failed");
      });

      const result = await cacheGet(kv, "fail-bg", fetcher, undefined, SWR_OPTIONS);

      expect(result).toBe("stale-preserved");

      // Wait for background to complete
      await flushBackground();

      // The cache should still have the original stale value (not overwritten)
      // Since the bg fetch failed, set should not have been called with a new value
      expect(kv.set).not.toHaveBeenCalled();
    });

    it("updates cache timestamp after successful background revalidation", async () => {
      const kv = createMockStorage({
        value: "stale",
        meta: { timestamp: Date.now() - 5000 },
      });
      const fetcher = mock(async () => "refreshed");

      await cacheGet(kv, "ts-update", fetcher, undefined, SWR_OPTIONS);
      await flushBackground();

      // setMeta should have been called with a recent timestamp
      const metaCalls = (kv.setMeta as ReturnType<typeof mock>).mock.calls;
      expect(metaCalls.length).toBeGreaterThan(0);
      const lastMeta = metaCalls[metaCalls.length - 1]![1] as { timestamp: number };
      expect(Date.now() - lastMeta.timestamp).toBeLessThan(1000);
    });
  });
});
