import type { StorageValue, Storage } from "unstorage";
import { getLogger } from "../logger";

const logger = getLogger({ name: "kv-cache" });

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
  logger.trace({ key }, "readThroughCache");

  // Create rate limiter if requestsPerSecond is specified
  const rateLimiter = options.requestsPerSecond
    ? new RateLimiter(options.requestsPerSecond)
    : null;

  // TTL in ms, default to 1 day
  const ttl = options.ttl ?? 24 * 60 * 60 * 1000;

  // Dedupe requests for the same key.
  if (dupeRequestsCache.has(key)) {
    logger.trace({ key }, "readThroughCache dupeRequest");
    return dupeRequestsCache.get(key) as Promise<T>;
  }

  const unresolvedPromise = Promise.all([kv.get<T>(key), kv.getMeta(key)]).then(
    async ([cached, meta]) => {
      const now = Date.now();
      let isExpired = meta
        ? cached && typeof meta["timestamp"] === "number"
          ? now - meta["timestamp"] > ttl
          : true
        : true;

      if (cached && !isExpired) {
        logger.trace({ key, cached }, "readThroughCache hit");
        return cached;
      }

      logger.trace(
        { key },
        isExpired ? "readThroughCache expired" : "readThroughCache miss",
      );

      // Apply rate limiting before fetch if enabled
      if (rateLimiter) {
        await rateLimiter.acquireToken();
      }

      return fetch({ key })
        .then((fresh) => {
          logger.trace({ key, fresh }, "readThroughCache set");
          kv.set(key, fresh);
          kv.setMeta(key, { timestamp: now });
          return fresh;
        })
        .catch((err) => {
          logger.error({ err }, "readThroughCache error");
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
