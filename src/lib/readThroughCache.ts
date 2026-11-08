import type { StorageValue, Storage } from "unstorage";

/**
 * Foreground misses and stale refreshes share fetch ownership, but unrelated
 * storage instances must never share values. Entries live until persistence settles.
 */
const fetches = new WeakMap<object, Map<string, Promise<StorageValue>>>();

export type ReadThroughCacheOptions = {
  /**
   * Time to live for cache in milliseconds.
   * @default 86400000 (1 day in ms)
   */
  ttl?: number;
  /**
   * Enables stale-while-revalidate. When cache age is between revalidateAfter and ttl,
   * serve stale data immediately while triggering a background fetch.
   * Must be less than ttl. In milliseconds.
   */
  revalidateAfter?: number;
};

/**
 * Read a value from the cache, or fetch it if it's not present.
 */
export async function readThroughCache<T extends StorageValue>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kv: Storage<any>,
  key: string,
  fetch: (ctx: { key: string }) => Promise<T>,
  defaultValue?: T,
  options: ReadThroughCacheOptions = {},
): Promise<T> {
  // TTL in ms, default to 1 day
  const ttl = options.ttl ?? 24 * 60 * 60 * 1000;
  const revalidateAfter = options.revalidateAfter;

  const [cached, meta] = await Promise.all([kv.get<T>(key), kv.getMeta(key)]);
  const timestamp = meta && typeof meta["timestamp"] === "number" ? meta["timestamp"] : null;
  const age = timestamp !== null ? Date.now() - timestamp : Infinity;
  const hasCached = cached !== null && cached !== undefined;

  if (hasCached && timestamp !== null && age < (revalidateAfter ?? ttl)) {
    return cached;
  }

  const isStale =
    hasCached &&
    timestamp !== null &&
    revalidateAfter != null &&
    age >= revalidateAfter &&
    age < ttl;

  let pending = fetches.get(kv);
  if (!pending) {
    pending = new Map();
    fetches.set(kv, pending);
  }
  let flight = pending.get(key) as Promise<T> | undefined;
  if (!flight) {
    // Defer invocation until ownership is registered; synchronous throws must also
    // release ownership and follow the same failure path as rejected fetches.
    flight = Promise.resolve()
      .then(() => fetch({ key }))
      .then(async (fresh) => {
        const timestamp = Date.now(); // A slow fetch must not be born stale.
        try {
          // Never stamp old data fresh when the value write fails.
          await kv.set(key, fresh);
          await kv.setMeta(key, { timestamp });
        } catch (err) {
          console.warn(`[readThroughCache] cache write failed for key "${key}":`, err);
        }
        return fresh;
      })
      .finally(() => pending.delete(key));
    pending.set(key, flight);
    if (isStale) {
      // Observe background failures without replacing the shared rejected flight:
      // an expired reader joining it must use its own default, not stale data.
      void flight.catch((err) => {
        console.warn(`[readThroughCache] background revalidation failed for key "${key}":`, err);
      });
    }
  }

  if (isStale) return cached;
  // Expired/missing entries block, including when a stale reader started the fetch.
  return flight.catch(() => defaultValue as T);
}
