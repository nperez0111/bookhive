import type { StorageValue, Storage } from "unstorage";
import { getLogger } from "../logger";

const logger = getLogger({ name: "kv-cache" });

/**
 * If multiple requests for the same key are made at the same time, we only want
 * to fetch the value once. This cache stores the promise for the fetch.
 */
const dupeRequestsCache = new Map<string, Promise<StorageValue>>();

/**
 * Read a value from the cache, or fetch it if it's not present.
 */
export async function readThroughCache<T extends StorageValue>(
  kv: Storage<NoInfer<T>>,
  key: string,
  fetch: (ctx: { key: string }) => Promise<T>,
  defaultValue?: T,
): Promise<T> {
  logger.trace({ key }, "readThroughCache");

  // Dedupe requests for the same key.
  if (dupeRequestsCache.has(key)) {
    logger.trace({ key }, "readThroughCache dupeRequest");
    return dupeRequestsCache.get(key) as Promise<T>;
  }

  const unresolvedPromise = kv.get<T>(key).then((cached) => {
    if (cached) {
      logger.trace({ key, cached }, "readThroughCache hit");
      return cached;
    }

    logger.trace({ key }, "readThroughCache miss");
    return fetch({ key })
      .then((fresh) => {
        logger.trace({ key, fresh }, "readThroughCache set");
        kv.set(key, fresh);
        return fresh;
      })
      .catch((err) => {
        logger.error({ err }, "readThroughCache error");
        return defaultValue as T;
      });
  });

  dupeRequestsCache.set(key, unresolvedPromise);

  try {
    return (await unresolvedPromise) as Promise<T>;
  } finally {
    // Make sure to delete the promise from the cache once it's resolved.
    dupeRequestsCache.delete(key);
  }
}
