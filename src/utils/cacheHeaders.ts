/**
 * The single source of truth for HTTP caching policy.
 *
 * One rule:
 *   - Signed in (`sid` cookie present) → nothing is cached, ever. Always fresh.
 *   - Signed out → cache aggressively, so Cloudflare absorbs the scraper load
 *     on the public pages.
 *
 * This lives in one place because the policy has to be restated at three
 * layers that each get a different view of the response:
 *   - `cacheControl()` (src/routes/lib.ts) and the routes themselves, which run
 *     before anyone knows the final status;
 *   - `anonPageCache` (src/middleware/anon-page-cache.ts), which bypasses on the
 *     session cookie;
 *   - the nitro `response` hook (server/plugins/cache-headers.ts), which is the
 *     only layer that sees the response actually leaving the process.
 *
 * Keeping them in sync by hand is how personalized HTML ended up advertising
 * itself as publicly cacheable for 30 days.
 */

/** iron-session cookie (see getSessionConfig in src/auth/router.tsx). */
export const SESSION_COOKIE_RE = /(^|;\s*)sid=/;

/**
 * Personalized HTML. `no-store` rather than `max-age=0, must-revalidate`
 * because only `no-store` keeps the page out of the browser's disk cache
 * entirely — which is what makes back/forward navigation fresh too, and what
 * stops a signed-out machine from holding another account's rendered pages.
 */
export const NO_STORE = "private, no-store";

/** Anonymous HTML on the bot-heavy public routes. Matches PAGE_CACHE_TTL_MS. */
export const PUBLIC_HTML = "public, max-age=3600, stale-while-revalidate=600";

/** Anonymous error/404 pages — cacheable, but not for long. */
export const PUBLIC_ERROR_HTML = "public, max-age=60";

/**
 * Files under public/. Stable names (not content-hashed), so a long TTL plus
 * stale-while-revalidate rather than `immutable`.
 */
export const STATIC_ASSET_CACHE_CONTROL = "public, max-age=2592000, stale-while-revalidate=86400";

const STATIC_ASSET_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".ico", ".webmanifest", ".webp"];

export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  return SESSION_COOKIE_RE.test(cookieHeader ?? "");
}

/**
 * The route groups whose anonymous HTML is worth caching publicly: high-volume,
 * bot-heavy, and identical for every signed-out visitor.
 */
export function isPublicallyCachedRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/books/") ||
    pathname === "/explore" ||
    pathname.startsWith("/explore/") ||
    pathname.startsWith("/authors/")
  );
}

/**
 * The Cache-Control an HTML response should carry, or `null` for "the app
 * already said something sensible — leave it alone".
 */
export function cacheControlForHtml({
  pathname,
  hasSession,
  status,
}: {
  pathname: string;
  hasSession: boolean;
  status: number;
}): string | null {
  // The rule. Unconditional on path, so no route can opt out of it by accident.
  if (hasSession) return NO_STORE;
  if (!isPublicallyCachedRoute(pathname)) return null;
  return status === 200 ? PUBLIC_HTML : PUBLIC_ERROR_HTML;
}

/**
 * Long-TTL caching for files under public/. Replaces the `/**\/*.png`-style
 * nitro route rules, which silently matched *every* route: rou3 stops parsing a
 * pattern at the first `**` segment and discards the rest, so `/**\/*.png`
 * degrades to `/**`. Nitro's static handler sets no Cache-Control of its own, so
 * something has to do this.
 */
export function staticAssetCacheControl(pathname: string): string | null {
  const lower = pathname.toLowerCase();
  return STATIC_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext))
    ? STATIC_ASSET_CACHE_CONTROL
    : null;
}
