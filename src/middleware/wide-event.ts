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

function toErrorPayload(err: unknown): { message: string; type: string } {
  if (err instanceof Error) {
    return { message: err.message, type: err.name };
  }
  return { message: String(err), type: "Error" };
}

function shouldEmitForPath(path: string): boolean {
  if (SKIP_PATHS.includes(path)) return false;
  return !SKIP_PREFIXES.some((p) => path.startsWith(p));
}

export function wideEventMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = Date.now();
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);

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

      // Ensure error is in the log for 5xx: from bag (string/object), c.error, or requestError (thrown or set by handler)
      if (outcome === "error") {
        const fromBag = wideEvent["error"];
        const normalized =
          typeof fromBag === "string"
            ? { message: fromBag, type: "Error" as const }
            : fromBag &&
                typeof fromBag === "object" &&
                "message" in fromBag &&
                typeof (fromBag as { message: unknown }).message === "string"
              ? (fromBag as { message: string; type?: string })
              : null;
        if (normalized && typeof normalized.message === "string") {
          wideEvent["error"] = {
            message: normalized.message,
            type:
              typeof normalized.type === "string" ? normalized.type : "Error",
          };
        } else {
          const err = c.error ?? c.get("requestError");
          if (err !== undefined) {
            wideEvent["error"] = toErrorPayload(err);
          }
        }
      }

      const level = outcome === "error" ? "error" : "info";
      c.get("appLogger")[level](wideEvent);
    }
  };
}
