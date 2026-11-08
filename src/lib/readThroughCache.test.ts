import { describe, it, expect, mock } from "bun:test";
import { readThroughCache, type ReadThroughCacheOptions } from "./readThroughCache";
import type { Storage, StorageMeta } from "unstorage";
import { createStorage } from "unstorage";
import sqliteKv, { createSharedKvDb } from "../sqlite-kv";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readThroughCache", () => {
  describe("real unstorage SQLite metadata", () => {
    it("honors custom freshness over native metadata and caches falsy values", async () => {
      const { db } = createSharedKvDb(":memory:");
      const kv = createStorage({ driver: sqliteKv({ table: "cache", db }) });
      try {
        await kv.set("key", false);
        await kv.setMeta("key", { timestamp: 0 });
        expect((await kv.getMeta("key", { nativeOnly: true }))["timestamp"]).toBeGreaterThan(0);
        expect((await kv.getMeta("key"))["timestamp"]).toBe(0);
        const fetcher = mock(async () => 0);
        expect(await readThroughCache<number | boolean>(kv, "key", fetcher)).toBe(0);
        expect(await readThroughCache<number | boolean>(kv, "key", fetcher)).toBe(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        await kv.dispose();
      }
    });

    it("preserves fetched success but does not refresh old custom metadata when publication fails", async () => {
      const { db } = createSharedKvDb(":memory:");
      const driver = sqliteKv({ table: "cache", db });
      let failMetadata = false;
      const kv = createStorage<string>({
        driver: {
          ...driver,
          async setItem(key, value, options) {
            if (failMetadata && key === "key$") throw new Error("metadata unavailable");
            await driver.setItem!(key, value, options);
          },
        },
      });
      try {
        await kv.set("key", "old");
        await kv.setMeta("key", { timestamp: 0 });
        failMetadata = true;
        expect(await cacheGet(kv, "key", async () => "fresh", "fallback")).toBe("fresh");
        expect(await kv.get("key")).toBe("fresh");
        expect((await kv.getMeta("key"))["timestamp"]).toBe(0);
        failMetadata = false;
        const retry = mock(async () => "revalidated");
        expect(await cacheGet(kv, "key", retry)).toBe("revalidated");
        expect(retry).toHaveBeenCalledTimes(1);
        expect(await cacheGet(kv, "key", retry)).toBe("revalidated");
        expect(retry).toHaveBeenCalledTimes(1);
      } finally {
        await kv.dispose();
      }
    });
  });

  // ------ Basic behavior (no SWR) ------

  describe("basic (no SWR)", () => {
    for (const value of [false, 0, ""]) {
      it(`keeps cached ${JSON.stringify(value)} as a fresh hit`, async () => {
        const kv = createMockStorage({ value, meta: { timestamp: Date.now() } });
        const fetcher = mock(async () => "unexpected");
        expect(await readThroughCache<string | number | boolean>(kv, "falsey", fetcher)).toBe(
          value,
        );
        expect(fetcher).not.toHaveBeenCalled();
      });
    }

    for (const method of ["set", "setMeta"] as const) {
      it(`keeps a joined refresh successful when background ${method} fails`, async () => {
        const kv = createMockStorage({ value: "stale", meta: { timestamp: Date.now() - 5000 } });
        (kv[method] as ReturnType<typeof mock>).mockImplementation(async () => {
          throw new Error("background cache write unavailable");
        });
        const refreshed = deferred<string>();
        const fetcher = mock(() => refreshed.promise);
        expect(
          await cacheGet(kv, "write-failure", fetcher, undefined, {
            revalidateAfter: 1000,
            ttl: 10_000,
          }),
        ).toBe("stale");
        // A stricter reader must wait for the same refresh, not receive stale data.
        const foreground = cacheGet(kv, "write-failure", fetcher, "fallback", { ttl: 1000 });
        await flushBackground();
        refreshed.resolve("fresh");
        expect(await foreground).toBe("fresh");
        expect(fetcher).toHaveBeenCalledTimes(1);
      });
    }

    for (const method of ["set", "setMeta"] as const) {
      it(`keeps fetched success for all waiters when ${method} fails`, async () => {
        const kv = createMockStorage();
        (kv[method] as ReturnType<typeof mock>).mockImplementation(async () => {
          throw new Error("cache unavailable");
        });
        const fetcher = mock(async () => "fresh");
        const results = await Promise.all([
          cacheGet(kv, "write-failure", fetcher, "fallback-a"),
          cacheGet(kv, "write-failure", fetcher, "fallback-b"),
        ]);
        expect(results).toEqual(["fresh", "fresh"]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        if (method === "set") expect(kv.setMeta).not.toHaveBeenCalled();
        // A failed persistence attempt must not retain the settled flight forever.
        await cacheGet(kv, "write-failure", fetcher);
        expect(fetcher).toHaveBeenCalledTimes(2);
      });
    }

    it("timestamps the entry only after the fetch completes", async () => {
      const kv = createMockStorage();
      const fetchStarted = deferred<void>();
      const fetched = deferred<string>();
      const result = cacheGet(kv, "slow", () => {
        fetchStarted.resolve();
        return fetched.promise;
      });
      await fetchStarted.promise;
      await flushBackground();
      const completedAt = Date.now();
      fetched.resolve("fresh");
      expect(await result).toBe("fresh");
      expect(kv._getMeta()["timestamp"]).toBeGreaterThanOrEqual(completedAt);
    });

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
    it("retains ownership until cache persistence settles", async () => {
      const kv = createMockStorage();
      const writing = deferred<void>();
      const written = deferred<void>();
      (kv.set as ReturnType<typeof mock>).mockImplementation(() => {
        writing.resolve();
        return written.promise;
      });
      const fetcher = mock(async () => "fresh");
      const first = cacheGet(kv, "persisting", fetcher);
      await writing.promise;
      const second = cacheGet(kv, "persisting", fetcher);
      await flushBackground();
      expect(fetcher).toHaveBeenCalledTimes(1);
      written.resolve();
      expect(await Promise.all([first, second])).toEqual(["fresh", "fresh"]);
    });

    it("does not share fetches between storage instances with the same key", async () => {
      const a = createMockStorage();
      const b = createMockStorage();
      const release = deferred<string>();
      const started = deferred<void>();
      const first = cacheGet(a, "same-key", () => {
        started.resolve();
        return release.promise;
      });
      await started.promise;
      const second = await cacheGet(b, "same-key", async () => "b");
      release.resolve("a");
      expect(await first).toBe("a");
      expect(second).toBe("b");
      expect(a._getValue()).toBe("a");
      expect(b._getValue()).toBe("b");
    });

    it("cleans up rejected flights and applies each waiter's own default", async () => {
      const kv = createMockStorage();
      const fetcher = mock(() => {
        throw new Error("synchronous fetch failure");
      });
      expect(
        await Promise.all([
          cacheGet(kv, "failure", fetcher, "a"),
          cacheGet(kv, "failure", fetcher, "b"),
        ]),
      ).toEqual(["a", "b"]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await cacheGet(kv, "failure", async () => "retry")).toBe("retry");
    });

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

    for (const value of [false, 0, ""]) {
      it(`serves stale ${JSON.stringify(value)} while refreshing`, async () => {
        const kv = createMockStorage({ value, meta: { timestamp: Date.now() - 5000 } });
        const refreshed = deferred<string>();
        const fetcher = mock(() => refreshed.promise);
        expect(
          await readThroughCache<string | number | boolean>(
            kv,
            "falsey",
            fetcher,
            undefined,
            SWR_OPTIONS,
          ),
        ).toBe(value);
        expect(fetcher).toHaveBeenCalledTimes(1);
        refreshed.resolve("fresh");
        await flushBackground();
        expect(kv._getValue()).toBe("fresh");
      });
    }

    for (const fails of [false, true]) {
      it(`joins stale refresh after expiry (${fails ? "failure" : "success"})`, async () => {
        const kv = createMockStorage({ value: "stale", meta: { timestamp: Date.now() - 5000 } });
        const refreshed = deferred<string>();
        const fetcher = mock(() => refreshed.promise);
        expect(await cacheGet(kv, "transition", fetcher, undefined, SWR_OPTIONS)).toBe("stale");
        // Another stale reader must not block on the shared refresh.
        expect(await cacheGet(kv, "transition", fetcher, undefined, SWR_OPTIONS)).toBe("stale");
        await kv.setMeta("transition", { timestamp: Date.now() - 20_000 });
        const foreground = cacheGet(kv, "transition", fetcher, "fallback", SWR_OPTIONS);
        // Force the foreground read through cache inspection before settling the refresh.
        await flushBackground();
        expect(fetcher).toHaveBeenCalledTimes(1);
        if (fails) refreshed.reject(new Error("refresh failed"));
        else refreshed.resolve("fresh");
        expect(await foreground).toBe(fails ? "fallback" : "fresh");
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(await cacheGet(kv, "transition", async () => "retry", undefined, SWR_OPTIONS)).toBe(
          fails ? "retry" : "fresh",
        );
      });
    }

    it("does not reserve a synthetic background key in the user namespace", async () => {
      const kv = createMockStorage({ value: "stale", meta: { timestamp: Date.now() - 5000 } });
      const refreshed = deferred<string>();
      expect(await cacheGet(kv, "key", () => refreshed.promise, undefined, SWR_OPTIONS)).toBe(
        "stale",
      );
      await kv.setMeta("__bg:key", {});
      const other = cacheGet(kv, "__bg:key", async () => "other");
      refreshed.resolve("fresh");
      expect(await other).toBe("other");
    });

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
