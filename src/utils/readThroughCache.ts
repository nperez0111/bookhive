import type { StorageValue, Storage } from "unstorage";

/**
 * If multiple requests for the same key are made at the same time, we only want
 * to fetch the value once. This cache stores the promise for the fetch.
 */
const dupeRequestsCache = new Map<string, Promise<StorageValue>>();

/**
 * Simple rate limiter using token bucket algorithm
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly requestsPerSecond: number;

  constructor(requestsPerSecond: number) {
    this.requestsPerSecond = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  async acquireToken(): Promise<void> {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;

    // Refill tokens based on time passed
    this.tokens = Math.min(
      this.requestsPerSecond,
      this.tokens + timePassed * this.requestsPerSecond,
    );
    this.lastRefill = now;

    if (this.tokens < 1) {
      // Wait until we have a token
      const waitTime = ((1 - this.tokens) / this.requestsPerSecond) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.tokens = 1;
    }

    this.tokens -= 1;
  }
}

export type ReadThroughCacheOptions = {
  /**
   * Number of requests allowed per second. If not provided, no rate limiting is applied.
   */
  requestsPerSecond?: number;
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
  kv: Storage<NoInfer<T>>,
  key: string,
  fetch: (ctx: { key: string }) => Promise<T>,
  defaultValue?: T,
  options: ReadThroughCacheOptions = {},
): Promise<T> {
  // Create rate limiter if requestsPerSecond is specified
  const rateLimiter = options.requestsPerSecond ? new RateLimiter(options.requestsPerSecond) : null;

  // TTL in ms, default to 1 day
  const ttl = options.ttl ?? 24 * 60 * 60 * 1000;
  const revalidateAfter = options.revalidateAfter;

  // Dedupe requests for the same key.
  if (dupeRequestsCache.has(key)) {
    return dupeRequestsCache.get(key) as Promise<T>;
  }

  const unresolvedPromise = Promise.all([kv.get<T>(key), kv.getMeta(key)]).then(
    async ([cached, meta]) => {
      const now = Date.now();
      const timestamp = meta && typeof meta["timestamp"] === "number" ? meta["timestamp"] : null;
      const age = timestamp !== null ? now - timestamp : Infinity;

      // Fresh: within revalidateAfter (if SWR) or within ttl
      const isFresh = cached && timestamp !== null && age < (revalidateAfter ?? ttl);
      // Stale but serveable: SWR enabled, between revalidateAfter and ttl
      const isStale =
        cached &&
        timestamp !== null &&
        revalidateAfter != null &&
        age >= revalidateAfter &&
        age < ttl;

      if (isFresh) {
        return cached;
      }

      if (isStale) {
        // Serve stale immediately, revalidate in background
        const bgKey = `__bg:${key}`;
        if (!dupeRequestsCache.has(bgKey)) {
          const bgPromise = (async () => {
            if (rateLimiter) await rateLimiter.acquireToken();
            const fresh = await fetch({ key });
            await Promise.all([kv.set(key, fresh), kv.setMeta(key, { timestamp: Date.now() })]);
            return fresh;
          })()
            .catch((err) => {
              console.warn(
                `[readThroughCache] background revalidation failed for key "${key}":`,
                err,
              );
              return cached;
            })
            .finally(() => {
              dupeRequestsCache.delete(bgKey);
            });
          dupeRequestsCache.set(bgKey, bgPromise as Promise<StorageValue>);
        }
        return cached;
      }

      // Expired or miss: block on fetch
      if (rateLimiter) {
        await rateLimiter.acquireToken();
      }

      return fetch({ key })
        .then(async (fresh) => {
          await Promise.all([kv.set(key, fresh), kv.setMeta(key, { timestamp: now })]);
          return fresh;
        })
        .catch(() => {
          return defaultValue as T;
        });
    },
  );

  dupeRequestsCache.set(key, unresolvedPromise);

  try {
    return (await unresolvedPromise) as Promise<T>;
  } finally {
    // Make sure to delete the promise from the cache once it's resolved.
    dupeRequestsCache.delete(key);
  }
}
