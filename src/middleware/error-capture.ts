// Catches thrown errors, stores them for wide-event logging, then rethrows.
// Must mount after wide-event middleware so requestError is set before its finally runs.
// Handlers that catch and return 5xx themselves should call c.set('requestError', e) to be included in the log.
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
