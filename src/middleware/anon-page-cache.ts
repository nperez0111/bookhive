/**
 * Full-page HTML cache for anonymous (no session cookie) GET requests on
 * bot-heavy public routes (/books/:hiveId, /explore*, /authors/*).
 *
 * Rendered HTML is stored in the shared SQLite KV (`page:` mount), so one
 * render per URL per TTL serves every worker process. Logged-in requests
 * bypass the cache entirely and get their Cache-Control downgraded to
 * `private` so CDN "cache everything" rules can never store personalized HTML.
 */
import { createMiddleware } from "hono/factory";
import type { Storage } from "unstorage";

import type { AppEnv } from "../context";

/** iron-session cookie (see getSessionConfig in src/auth/router.tsx). */
const SESSION_COOKIE_RE = /(^|;\s*)sid=/;

/**
 * Query params that may vary the cached page. Requests with any other param
 * (utm_*, force-refresh, …) pass through uncached — this bounds cache-key
 * cardinality and keeps cache poisoning via junk params impossible.
 */
const ALLOWED_QUERY_PARAMS = new Set(["page", "sort", "lang", "review-id"]);

export const PAGE_CACHE_TTL_MS = 60 * 60 * 1000; // matches Cache-Control max-age=3600 on these routes
const MAX_BODY_BYTES = 512 * 1024;

/** Served on cache hits and misses when the route's Cache-Control didn't reach
 * the final response (headers set via the cacheControl helper after next()
 * don't survive to the client; nitro's route-rule headers then leak a 30-day
 * public value). Keeps the CDN TTL aligned with this cache's TTL. */
const DEFAULT_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=600";

/** HTML is gzipped (~5-10x) before storage so a bot sweep of the long tail
 * costs megabytes of KV disk, not gigabytes. */
type CachedPage = {
  bodyGzipB64: string;
  contentType: string;
  cacheControl: string;
};

/**
 * In-flight renders keyed by cache key, so a stampede of anonymous requests
 * for the same URL (per process) results in a single render. Resolves to null
 * when the response turned out to be uncacheable.
 */
const inflight = new Map<string, Promise<CachedPage | null>>();

/**
 * Requests already being handled by an outer instance of this middleware.
 * Guards against overlapping route mounts (e.g. "/explore/*" also matches
 * "/explore") running the middleware twice for one request — the inner run
 * would await the outer's in-flight promise and deadlock.
 */
const activeRequests = new WeakSet<Request>();

function hasSessionCookie(cookieHeader: string | undefined): boolean {
  return SESSION_COOKIE_RE.test(cookieHeader ?? "");
}

function serveCached(page: CachedPage): Response | null {
  try {
    const body = Bun.gunzipSync(Buffer.from(page.bodyGzipB64, "base64"));
    const headers: Record<string, string> = {
      "content-type": page.contentType,
      "x-page-cache": "hit",
    };
    if (page.cacheControl) headers["cache-control"] = page.cacheControl;
    return new Response(body, { status: 200, headers });
  } catch {
    return null;
  }
}

/** Extract a storable page from the live response, or null if uncacheable. */
async function extractCacheable(res: Response): Promise<CachedPage | null> {
  if (res.status !== 200 || res.headers.has("set-cookie")) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return null;
  const body = await res.clone().text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return null;
  return {
    bodyGzipB64: Buffer.from(Bun.gzipSync(body)).toString("base64"),
    contentType,
    cacheControl: res.headers.get("cache-control") || DEFAULT_CACHE_CONTROL,
  };
}

export function anonPageCache(kv: Storage) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method !== "GET") return next();
    if (activeRequests.has(c.req.raw)) return next();
    activeRequests.add(c.req.raw);

    if (hasSessionCookie(c.req.header("cookie"))) {
      await next();
      // Safety net for CDN edge caching: never let a logged-in (personalized)
      // response advertise itself as publicly cacheable. Unconditional because
      // headers set via the cacheControl helper don't reliably reach the final
      // response (nitro route-rule headers fill the gap with a public value).
      c.res.headers.set("cache-control", "private, max-age=0, must-revalidate");
      return;
    }

    const url = new URL(c.req.url);
    for (const param of url.searchParams.keys()) {
      if (!ALLOWED_QUERY_PARAMS.has(param)) return next();
    }
    const query = [...url.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const key = `page:${url.pathname}${query ? `?${query}` : ""}`;

    // Fresh cached copy?
    const meta = await kv.getMeta(key);
    if (meta?.mtime && Date.now() - new Date(meta.mtime).getTime() < PAGE_CACHE_TTL_MS) {
      const page = await kv.getItem<CachedPage>(key);
      if (page?.bodyGzipB64) {
        const cached = serveCached(page);
        if (cached) {
          c.res = cached;
          return;
        }
      }
    }

    // Someone in this process is already rendering this URL — wait for them.
    const pending = inflight.get(key);
    if (pending) {
      const result = await pending.catch(() => "error" as const);
      if (result === "error") {
        return c.text("Service temporarily unavailable", 503);
      }
      if (result) {
        const cached = serveCached(result);
        if (cached) {
          c.res = cached;
          return;
        }
      }
      return next();
    }

    const render = (async () => {
      await next();
      const page = await extractCacheable(c.res);
      if (page) {
        c.res.headers.set("x-page-cache", "miss");
        c.res.headers.set("cache-control", page.cacheControl);
        await kv.setItem(key, page);
      }
      return page;
    })();
    inflight.set(key, render);
    try {
      await render;
    } finally {
      inflight.delete(key);
    }
  });
}
