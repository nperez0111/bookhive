import type { StorageValue } from "unstorage";
import type { AppContext } from "..";

/**
 * Read a value from the cache, or fetch it if it's not present.
 */
export function readThroughCache<T extends StorageValue>(
  ctx: AppContext,
  key: string,
  fetch: () => Promise<T>,
  defaultValue?: T,
): Promise<T> {
  ctx.logger.trace({ key }, "readThroughCache");
  return ctx.kv.get<T>(key).then((cached) => {
    if (cached) {
      ctx.logger.trace({ key, cached }, "readThroughCache hit");
      return cached;
    }

    ctx.logger.trace({ key }, "readThroughCache miss");
    return fetch()
      .then((fresh) => {
        ctx.logger.trace({ key, fresh }, "readThroughCache set");
        ctx.kv.set(key, fresh);
        return fresh;
      })
      .catch((err) => {
        ctx.logger.error({ err }, "readThroughCache error");
        return defaultValue as T;
      });
  });
}
