/**
 * Nitro plugin: authoritative Cache-Control for the bot-heavy public HTML
 * routes (/books/*, /explore*, /authors/*).
 *
 * Why here and not in Hono middleware: nitro's route-rule `headers` middleware
 * (the static-asset globs like `/**\/*.png` in vite.config.ts routeRules) leaks
 * onto app routes and its 30-day public value can replace the Cache-Control
 * the Hono app set. The `response` hook runs on the final Response right
 * before send, so values set here always reach the client (same mechanism the
 * request-tracing plugin uses for Server-Timing).
 *
 * Policy: anonymous GET HTML → public 1h (matches the anon page cache TTL in
 * src/middleware/anon-page-cache.ts); any request with a session cookie →
 * private, so a CDN "cache everything" rule can never store personalized HTML.
 */
import { definePlugin } from "nitro";

const SESSION_COOKIE_RE = /(^|;\s*)sid=/;

const PUBLIC_HTML = "public, max-age=3600, stale-while-revalidate=600";
const PRIVATE_HTML = "private, max-age=0, must-revalidate";

function isCachedRouteGroup(pathname: string): boolean {
  return (
    pathname.startsWith("/books/") ||
    pathname === "/explore" ||
    pathname.startsWith("/explore/") ||
    pathname.startsWith("/authors/")
  );
}

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", (response, event) => {
    if (event.req.method !== "GET" && event.req.method !== "HEAD") return;
    if (!isCachedRouteGroup(new URL(event.req.url).pathname)) return;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return;

    if (SESSION_COOKIE_RE.test(event.req.headers.get("cookie") ?? "")) {
      response.headers.set("Cache-Control", PRIVATE_HTML);
    } else if (response.status === 200) {
      response.headers.set("Cache-Control", PUBLIC_HTML);
    } else {
      // Don't let error/404 pages sit in caches for long.
      response.headers.set("Cache-Control", "public, max-age=60");
    }
  });
});
