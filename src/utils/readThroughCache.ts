import type { StorageValue, Storage } from "unstorage";
import { getLogger } from "../logger";

const logger = getLogger({ name: "kv-cache" });
/**
 * Read a value from the cache, or fetch it if it's not present.
 */
export function readThroughCache<T extends StorageValue>(
  kv: Storage,
  key: string,
  fetch: () => Promise<T>,
  defaultValue?: T,
): Promise<T> {
  logger.trace({ key }, "readThroughCache");
  return kv.get<T>(key).then((cached) => {
    if (cached) {
      logger.trace({ key, cached }, "readThroughCache hit");
      return cached;
    }

    logger.trace({ key }, "readThroughCache miss");
    return fetch()
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
}
