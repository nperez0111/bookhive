/**
 * Catches thrown errors, stores them on the context for wide-event logging, then rethrows.
 * Mount after wide-event middleware so that when a route throws, we set c.requestError before
 * wide-event's finally runs. Handlers that catch and return 5xx should call c.set('requestError', e)
 * so the request log includes the error.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";

export function errorCaptureMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    try {
      await next();
    } catch (e) {
      c.set("requestError", e);
      throw e;
    }
  };
}
