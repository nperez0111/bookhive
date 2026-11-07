// Wide-event logging: one context-rich event per request. Middleware captures timing/status/environment; handlers add business context via ctx.addWideEventContext().
import type { MiddlewareHandler } from "hono";
import { setMetric } from "hono/timing";
import { env } from "../env";
import type { AppEnv } from "../context";
import { toErrorPayload } from "../lib/errors";
import { LABEL, requestsInFlight } from "../metrics";

const SKIP_PATHS = ["/healthcheck", "/metrics"];
const SKIP_PREFIXES = ["/public", "/images"];

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

    requestsInFlight.inc(LABEL.worker);
    try {
      await next();
    } finally {
      requestsInFlight.dec(LABEL.worker);
      if (shouldEmitForPath(c.req.path)) {
        const statusCode = c.res?.status ?? 500;
        const durationMs = Date.now() - start;
        const outcome =
          statusCode >= 500 ? "error" : statusCode >= 400 ? "client_error" : "success";

        const wideEvent: Record<string, unknown> = {
          msg: "request",
          request_id: requestId,
          method: c.req.method,
          path: c.req.path,
          status_code: statusCode,
          duration_ms: durationMs,
          outcome,
          timestamp: new Date().toISOString(),
          // Stable across OOM restarts, unlike pino's `pid`, so per-worker problems stay groupable in aggregate log queries.
          worker_index: env.WORKER_INDEX || "solo",
          env: {
            node_env: env.NODE_ENV,
            ...(env.BUILD_SHA ? { build_sha: env.BUILD_SHA } : {}),
          },
        };

        const bag = c.get("wideEventBag");
        if (bag && typeof bag === "object") {
          Object.assign(wideEvent, bag);
        }

        // Services/XRPC have no Hono dependency. Only these fixed numeric stages
        // are promoted to headers; never export arbitrary business context.
        const metric = c.get("metric");
        if (metric) {
          for (const stage of [
            "search_upstream",
            "search_persist",
            "search_local",
            "search_lookup",
            "search_hydrate",
            "search_genres",
            "search_session",
            "search_statuses",
          ]) {
            const ms = bag?.[`${stage}_ms`];
            if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
              setMetric(c, stage, ms);
            }
          }
          // Outer timing() emits the header after this middleware unwinds. Read
          // completed metrics, not cached response headers or descriptions.
          const timings: Record<string, number> = {};
          for (const header of metric.headers.slice(0, 64)) {
            const match = /^([A-Za-z][A-Za-z0-9_+.-]{0,63});dur=(\d+(?:\.\d+)?)(?:;|$)/.exec(
              header,
            );
            if (match && Number.isFinite(Number(match[2]))) timings[match[1]!] = Number(match[2]);
          }
          if (Object.keys(timings).length) wideEvent["server_timing_ms"] = timings;
        }

        // Ensure error is in the log for 5xx: from bag (string/object), c.error, or requestError.
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
              type: typeof normalized.type === "string" ? normalized.type : "Error",
            };
          } else {
            const err = c.error ?? c.get("requestError");
            if (err !== undefined) {
              wideEvent["error"] = toErrorPayload(err);
            } else {
              // A 5xx with no error attached means a handler swallowed the cause; mark it rather than log nothing actionable.
              wideEvent["error"] = {
                message: "handler returned 5xx without setting requestError",
                type: "UnattributedError",
              };
              wideEvent["error_unattributed"] = true;
            }
          }
        }

        const level = outcome === "error" ? "error" : "info";
        c.get("appLogger")[level](wideEvent);
      }
    }
  };
}
