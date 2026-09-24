/**
 * Full-page HTML cache for anonymous (no session cookie) GET requests on
 * bot-heavy public routes (/books/:hiveId, /explore*, /authors/*), stored in
 * the shared SQLite KV so one render per URL per TTL serves every worker.
 */
import { createMiddleware } from "hono/factory";
import type { Storage } from "unstorage";

import type { AppEnv } from "../context";
import { NO_STORE, hasSessionCookie } from "../core/cacheHeaders";

// Requests with any other param (utm_*, force-refresh, …) pass through uncached, to bound cache-key cardinality.
const ALLOWED_QUERY_PARAMS = new Set(["page", "sort", "lang", "review-id"]);

export const PAGE_CACHE_TTL_MS = 60 * 60 * 1000; // matches Cache-Control max-age=3600 on these routes

// Measured on the stored (gzipped) bytes, not the uncompressed body — otherwise pages that would have cost little in KV get rejected before compression.
const MAX_STORED_BYTES = 256 * 1024;
// Separate ceiling on the pre-compression buffer, purely to bound per-response memory.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// Fallback when the route's own Cache-Control doesn't survive to the final response; keeps the CDN TTL aligned with this cache's TTL.
const DEFAULT_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=600";

// Gzipped before storage so a bot sweep of the long tail costs KV disk, not memory.
type CachedPage = {
  bodyGzipB64: string;
  contentType: string;
  cacheControl: string;
};

// In-flight renders keyed by cache key, so a stampede of requests for the same URL (per process) collapses to a single render.
const inflight = new Map<string, Promise<CachedPage | null>>();

// Guards against overlapping route mounts (e.g. "/explore/*" also matching "/explore") running this middleware twice for one request — the inner run would await the outer's in-flight promise and deadlock.
const activeRequests = new WeakSet<Request>();

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

// Extract a storable page from the live response, or null if uncacheable.
async function extractCacheable(res: Response): Promise<CachedPage | null> {
  if (res.status !== 200 || res.headers.has("set-cookie")) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return null;
  const body = await res.clone().text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return null;
  const gzipped = Bun.gzipSync(body);
  if (gzipped.byteLength > MAX_STORED_BYTES) return null;
  return {
    bodyGzipB64: Buffer.from(gzipped).toString("base64"),
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
      // Never let a logged-in (personalized) response advertise itself as publicly cacheable to the CDN.
      c.res.headers.set("cache-control", NO_STORE);
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
    // Percent-encoded into the key, never joined with a literal `?` — unstorage's normalizeKey discards everything after `?`, which would collapse every query variant of a path onto one cache entry.
    const key = `page:${url.pathname}${query ? `:q:${encodeURIComponent(query)}` : ""}`;

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
