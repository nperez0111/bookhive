/**
 * Nitro plugin: the authoritative Cache-Control for every response.
 *
 * Runs as the `response` hook (not Hono middleware) because nitro's route-rule
 * header middleware runs after the Hono app and would overwrite it on any 2xx.
 * Policy lives in src/core/cacheHeaders.ts, shared by every layer.
 *
 * `Vary: Cookie` on HTML is load-bearing, not decoration — it's what makes a
 * browser re-request `/` after sign-in instead of replaying a cached page.
 * Cloudflare ignores `Vary` except `Accept-Encoding`, so the edge also needs a
 * "bypass cache when the `sid` cookie is present" rule for the same guarantee.
 */
import { definePlugin } from "nitro";

import {
  cacheControlForHtml,
  hasSessionCookie,
  staticAssetCacheControl,
} from "../../src/core/cacheHeaders";

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
