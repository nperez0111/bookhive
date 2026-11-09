/**
 * Full-page HTML cache for anonymous (no session cookie) GET requests on
 * bot-heavy public routes (/books/:hiveId, /explore*, /authors/*), stored in
 * the shared SQLite KV so one render per URL per TTL serves every worker.
 */
import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { parseAccept } from "hono/utils/accept";
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
// Optional cache extraction must not multiply its raw-body buffers across a stampede.
const MAX_ACTIVE_FILLS = 2;
let activeFills = 0;
let bufferedBytes = 0;
let skippedFills = 0;

export function getPageCacheMemoryStats() {
  return {
    page_cache_active_fills: activeFills,
    page_cache_buffered_bytes: bufferedBytes,
    page_cache_skipped_fills: skippedFills,
  };
}

// Fallback when the route's own Cache-Control doesn't survive to the final response; keeps the CDN TTL aligned with this cache's TTL.
const DEFAULT_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=600";

// Gzipped before storage so a bot sweep of the long tail costs KV disk, not memory.
type CachedPage = {
  bodyGzipB64: string;
  contentType: string;
  cacheControl: string;
  // Weak across identity/gzip/deflate: all represent the same decoded HTML.
  // Optional so entries written before this format remain readable until expiry.
  etag?: string;
};

// In-flight renders keyed by cache key, so a stampede of requests for the same URL (per process) collapses to a single render.
const inflight = new Map<string, Promise<CachedPage | null>>();

// Guards against overlapping route mounts (e.g. "/explore/*" also matching "/explore") running this middleware twice for one request — the inner run would await the outer's in-flight promise and deadlock.
const activeRequests = new WeakSet<Request>();

function pageEtag(gzip: Uint8Array): string {
  return `W/"page-v1-${createHash("sha256").update(gzip).digest("hex")}"`;
}

function matchesEtag(header: string | null, tag: string): boolean {
  return (
    header?.trim() === "*" ||
    (header
      ?.split(",")
      .some((value) => value.trim().replace(/^W\//, "") === tag.replace(/^W\//, "")) ??
      false)
  );
}

// Match the pinned Hono compressor's choice, including explicit q=0 overriding
// a wildcard and preferring deflate over a lower-quality gzip. Do not send gzip
// merely because it appears somewhere in Accept-Encoding.
function selectsGzip(header: string | null): boolean {
  if (header === null) return false;
  const accepts = parseAccept(header);
  const wildcard = accepts.find((accept) => accept.type === "*")?.q;
  let best: { encoding: string; q: number } | undefined;
  for (const encoding of ["gzip", "deflate"]) {
    const explicit = accepts.find((accept) => accept.type.toLowerCase() === encoding);
    const q = explicit ? explicit.q : (wildcard ?? 0);
    if (q === 1) return encoding === "gzip";
    if (q > 0 && (!best || q > best.q)) best = { encoding, q };
  }
  return best?.encoding === "gzip";
}

function serveCached(page: CachedPage, requestHeaders: Headers): Response | null {
  try {
    const gzip = Buffer.from(page.bodyGzipB64, "base64");
    if (gzip.byteLength > MAX_STORED_BYTES) return null;
    const headers: Record<string, string> = {
      "content-type": page.contentType,
      "x-page-cache": "hit",
      vary: "Cookie, Accept-Encoding",
    };
    if (page.cacheControl) headers["cache-control"] = page.cacheControl;
    if (page.etag !== undefined) {
      // Check consistency with the bytes we generated on fill, without expanding
      // them. This detects changed storage bytes, not arbitrary gzip validity.
      if (page.etag !== pageEtag(gzip)) return null;
      headers["etag"] = page.etag;
      if (matchesEtag(requestHeaders.get("if-none-match"), page.etag)) {
        delete headers["content-type"];
        delete headers["x-page-cache"];
        return new Response(null, { status: 304, headers });
      }
      if (
        selectsGzip(requestHeaders.get("accept-encoding")) &&
        !/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(page.cacheControl)
      ) {
        headers["content-encoding"] = "gzip";
        return new Response(gzip, { status: 200, headers });
      }
    }
    // Legacy entries have no validator: leave the outer ETag/compression path
    // intact until they expire. Identity/deflate clients still need raw bytes.
    const body = Bun.gunzipSync(gzip);
    return new Response(body, { status: 200, headers });
  } catch {
    return null;
  }
}

// Extract a storable page from the live response, or null if uncacheable.
async function extractCacheable(res: Response): Promise<CachedPage | null> {
  if (res.status !== 200 || res.headers.has("set-cookie")) return null;
  if (res.headers.has("content-encoding")) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return null;
  if (activeFills >= MAX_ACTIVE_FILLS) {
    skippedFills++;
    return null;
  }
  activeFills++;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    const reader = res.clone().body?.getReader();
    if (!reader) return null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (bytes + value.byteLength > MAX_BODY_BYTES) {
          // Awaiting cancellation of a tee can wait for the live response to be consumed.
          void reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
        bytes += value.byteLength;
        bufferedBytes += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const body = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, bytes);
    const gzipped = Bun.gzipSync(body);
    if (gzipped.byteLength > MAX_STORED_BYTES) return null;
    return {
      bodyGzipB64: Buffer.from(gzipped.buffer, gzipped.byteOffset, gzipped.byteLength).toString(
        "base64",
      ),
      contentType,
      cacheControl: res.headers.get("cache-control") || DEFAULT_CACHE_CONTROL,
      etag: pageEtag(gzipped),
    };
  } finally {
    bufferedBytes -= bytes;
    activeFills--;
  }
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

    const cacheError = (operation: string, error: unknown) => {
      const bag = c.get("wideEventBag") ?? {};
      bag["page_cache_error"] = operation;
      delete bag["page_cache_error_code"];
      if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
        bag["page_cache_error_code"] = error.code.slice(0, 64);
      }
      c.set("wideEventBag", bag);
    };
    try {
      const meta = await kv.getMeta(key);
      if (meta?.mtime && Date.now() - new Date(meta.mtime).getTime() < PAGE_CACHE_TTL_MS) {
        const page = await kv.getItem<CachedPage>(key);
        if (page?.bodyGzipB64) {
          const cached = serveCached(page, c.req.raw.headers);
          if (cached) {
            c.res = cached;
            return;
          }
        }
      }
    } catch (error) {
      cacheError("read", error);
    }

    // Someone in this process is already rendering this URL — wait for them.
    const pending = inflight.get(key);
    if (pending) {
      const result = await pending.catch(() => "error" as const);
      if (result === "error") {
        return c.text("Service temporarily unavailable", 503);
      }
      if (result) {
        const cached = serveCached(result, c.req.raw.headers);
        if (cached) {
          c.res = cached;
          return;
        }
      }
      return next();
    }

    const render = (async () => {
      await next();
      let page: CachedPage | null;
      try {
        page = await extractCacheable(c.res);
      } catch (error) {
        cacheError("extract", error);
        return null;
      }
      if (page) {
        c.res.headers.set("cache-control", page.cacheControl);
        c.res.headers.set("etag", page.etag!);
        // The outer ETag middleware must retain these on conditional responses.
        for (const field of ["Cookie", "Accept-Encoding"]) {
          const vary = c.res.headers.get("vary");
          if (
            vary !== "*" &&
            !vary?.split(",").some((value) => value.trim().toLowerCase() === field.toLowerCase())
          ) {
            c.res.headers.set("vary", vary ? `${vary}, ${field}` : field);
          }
        }
        try {
          await kv.setItem(key, page);
          c.res.headers.set("x-page-cache", "miss");
        } catch (error) {
          cacheError("write", error);
          // Keep the rendered page available to in-flight waiters even if persistence failed.
        }
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
