/**
 * Wide-event logging: one context-rich event per request for observability.
 * Middleware captures timing, status, environment; handlers add business context
 * via ctx.addWideEventContext(). See .cursor/skills/logging-best-practices.
 */
import type { MiddlewareHandler } from "hono";
import { env } from "../env";
import type { AppEnv } from "../context";

const SKIP_PATHS = ["/healthcheck", "/metrics"];
const SKIP_PREFIXES = ["/public", "/images"];

function shouldEmitForPath(path: string): boolean {
  if (SKIP_PATHS.includes(path)) return false;
  return !SKIP_PREFIXES.some((p) => path.startsWith(p));
}

export function wideEventMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = Date.now();
    const requestId =
      c.req.header("x-request-id") ?? `req-${c.req.url}-${start}`;

    try {
      await next();
    } finally {
      if (!shouldEmitForPath(c.req.path)) {
        return;
      }

      const statusCode = c.res?.status ?? 500;
      const durationMs = Date.now() - start;
      const outcome =
        statusCode >= 500
          ? "error"
          : statusCode >= 400
            ? "client_error"
            : "success";

      const wideEvent: Record<string, unknown> = {
        msg: "request",
        request_id: requestId,
        method: c.req.method,
        path: c.req.path,
        status_code: statusCode,
        duration_ms: durationMs,
        outcome,
        timestamp: new Date().toISOString(),
        env: {
          node_env: env.NODE_ENV,
          ...(env.BUILD_SHA ? { build_sha: env.BUILD_SHA } : {}),
        },
      };

      const bag = c.get("wideEventBag");
      if (bag && typeof bag === "object") {
        Object.assign(wideEvent, bag);
      }

      if (c.error) {
        wideEvent["error"] = {
          message: c.error instanceof Error ? c.error.message : String(c.error),
          type: c.error instanceof Error ? c.error.name : "Error",
        };
      }

      const level = outcome === "error" ? "error" : "info";
      c.get("appLogger")[level](wideEvent);
    }
  };
}
