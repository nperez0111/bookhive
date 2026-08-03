/**
 * Nitro plugin: the authoritative Cache-Control for every response.
 *
 * Why here and not in Hono middleware: nitro's route-rule `headers` middleware
 * runs *after* the Hono app and overwrites what it set — `mergeHeaders(res,
 * preparedHeaders, res)` in h3 lets the route rule win on any 2xx. The
 * `response` hook runs on the final Response right before send, so values set
 * here always reach the client (same mechanism the request-tracing plugin uses
 * for Server-Timing).
 *
 * Policy (see src/utils/cacheHeaders.ts, which every layer shares):
 *   - HTML + `sid` cookie → `private, no-store`, on every path. Signed-in users
 *     always get a fresh render; nothing personalized is ever written to a disk
 *     cache or a CDN.
 *   - HTML, anonymous, on the bot-heavy public routes → public 1h, matching the
 *     anon page cache TTL in src/middleware/anon-page-cache.ts.
 *   - HTML, anonymous, anywhere else → whatever the route asked for.
 *   - Static files under public/ → long TTL. This replaces the extension route
 *     rules in vite.config.ts, which matched every route by accident (rou3
 *     truncates a pattern at `**`); nitro's static handler sets no
 *     Cache-Control of its own, so this hook has to.
 *
 * `Vary: Cookie` on HTML is load-bearing, not decoration. It is what makes a
 * browser re-request `/` after you sign in (so the `/` → `/home` redirect
 * actually fires instead of replaying the cached marketing page), and what stops
 * it handing you the cached signed-out copy of a book page. Note that Cloudflare
 * ignores `Vary` on everything except `Accept-Encoding`, so the edge needs a
 * "bypass cache when the `sid` cookie is present" rule to get the same guarantee.
 */
import { definePlugin } from "nitro";

import {
  cacheControlForHtml,
  hasSessionCookie,
  staticAssetCacheControl,
} from "../../src/utils/cacheHeaders";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", (response, event) => {
    if (event.req.method !== "GET" && event.req.method !== "HEAD") return;
    const { pathname } = new URL(event.req.url);
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
      const staticAsset = staticAssetCacheControl(pathname);
      if (staticAsset) response.headers.set("Cache-Control", staticAsset);
      return;
    }

    const directive = cacheControlForHtml({
      pathname,
      hasSession: hasSessionCookie(event.req.headers.get("cookie")),
      status: response.status,
    });
    if (directive) response.headers.set("Cache-Control", directive);

    appendVary(response, "Cookie");
    if (response.headers.has("content-encoding")) appendVary(response, "Accept-Encoding");
  });
});

/** Add a field to Vary without duplicating one that's already listed. */
function appendVary(response: Response, field: string): void {
  const current = response.headers.get("Vary");
  if (!current) {
    response.headers.set("Vary", field);
    return;
  }
  if (current === "*") return;
  const present = current.split(",").some((f) => f.trim().toLowerCase() === field.toLowerCase());
  if (!present) response.headers.set("Vary", `${current}, ${field}`);
}
