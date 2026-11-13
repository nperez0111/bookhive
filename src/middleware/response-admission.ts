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
  let anonymousActive = 0;
  let expensiveActive = 0;
  let expensiveAnonymousActive = 0;
  const anonymousLimit = Math.max(1, Math.floor(limit * 0.75));
  const expensiveLimit = Math.max(1, Math.floor(limit / 2));
  const expensiveAnonymousLimit = Math.max(1, Math.floor(expensiveLimit * 0.75));
  const rejectedByReason = { total: 0, anonymous: 0, expensive: 0, expensive_anonymous: 0 };
  const middleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (
      !["GET", "HEAD"].includes(c.req.method) ||
      EXCLUDED.some((path) => c.req.path === path || c.req.path.startsWith(`${path}/`))
    ) {
      return next();
    }
    // A scheduling hint only: any nonempty Cookie header gets priority. Never
    // restore OAuth here; arbitrary/spoofed cookies still share the hard caps.
    const anonymous = !c.req.header("Cookie")?.trim();
    const path = c.req.path;
    const expensive =
      ["/profile", "/og", "/explore", "/search"].some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      ) ||
      [
        "/xrpc/buzz.bookhive.searchBooks",
        "/xrpc/buzz.bookhive.getProfile",
        "/xrpc/buzz.bookhive.getExplore",
      ].includes(path);
    const reason =
      active >= limit
        ? "total"
        : anonymous && anonymousActive >= anonymousLimit
          ? "anonymous"
          : expensive && expensiveActive >= expensiveLimit
            ? "expensive"
            : expensive && anonymous && expensiveAnonymousActive >= expensiveAnonymousLimit
              ? "expensive_anonymous"
              : undefined;
    if (reason) {
      rejected++;
      rejectedByReason[reason]++;
      c.set("wideEventBag", {
        ...c.get("wideEventBag"),
        response_admission: "rejected",
        response_admission_reason: reason,
      });
      c.header("Cache-Control", "private, no-store");
      c.header("Retry-After", "5");
      return c.text("Service busy. Please retry shortly.", 503);
    }
    active++;
    if (anonymous) anonymousActive++;
    if (expensive) {
      expensiveActive++;
      if (anonymous) expensiveAnonymousActive++;
    }
    try {
      // Keep ownership through route rendering, cache extraction, ETag hashing and
      // compression setup. No timeout may release a slot while that work still runs.
      await next();
    } finally {
      active--;
      if (anonymous) anonymousActive--;
      if (expensive) {
        expensiveActive--;
        if (anonymous) expensiveAnonymousActive--;
      }
    }
  };
  return {
    middleware,
    getStats: () => ({
      active,
      limit,
      rejected,
      anonymousActive,
      anonymousLimit,
      expensiveActive,
      expensiveLimit,
      expensiveAnonymousActive,
      expensiveAnonymousLimit,
      rejectedByReason: { ...rejectedByReason },
    }),
  };
}
