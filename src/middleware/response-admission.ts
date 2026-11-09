import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";

// Segment-aware exclusions: these routes have separate streaming/admission lifetimes.
const EXCLUDED = [
  "/healthcheck",
  "/metrics",
  "/import",
  "/admin/export",
  "/library/books",
  "/opds/books",
  "/xrpc/buzz.bookhive.getPersonalBookFile",
  "/xrpc/buzz.bookhive.getPersonalBookCover",
];

export function createResponseAdmission(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("RESPONSE_PREPARATION_CONCURRENCY must be a positive integer");
  }
  let active = 0;
  let rejected = 0;
  const middleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (
      !["GET", "HEAD"].includes(c.req.method) ||
      EXCLUDED.some((path) => c.req.path === path || c.req.path.startsWith(`${path}/`))
    ) {
      return next();
    }
    if (active >= limit) {
      rejected++;
      c.set("wideEventBag", { ...c.get("wideEventBag"), response_admission: "rejected" });
      c.header("Cache-Control", "private, no-store");
      c.header("Retry-After", "5");
      return c.text("Service busy. Please retry shortly.", 503);
    }
    active++;
    try {
      // Keep ownership through route rendering, cache extraction, ETag hashing and
      // compression setup. No timeout may release a slot while that work still runs.
      await next();
    } finally {
      active--;
    }
  };
  return { middleware, getStats: () => ({ active, limit, rejected }) };
}
