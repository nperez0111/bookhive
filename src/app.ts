import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { jsxRenderer } from "hono/jsx-renderer";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { endTime, startTime, timing } from "hono/timing";

import { loadViteManifest, getAssetUrlsFromManifest, getInlineCss } from "./utils/manifest";
import { createContextMiddleware, type AppDeps, type AppEnv, type HonoServer } from "./context";
import { env } from "./env";
import { registry, startRuntimeMetricsCollection } from "./metrics";
import { anonPageCache } from "./middleware/anon-page-cache";
import { errorCaptureMiddleware } from "./middleware/error-capture";
import { opentelemetryMiddleware } from "./middleware/index.ts";
import { wideEventMiddleware } from "./middleware/wide-event";
import adminRoutes from "./routes/admin";
import debugRoutes from "./routes/debug";
import importRoutes from "./routes/import";
import { mainRouter } from "./routes";

export type CreateAppOptions = {
  startTime: string;
  deps: AppDeps;
};

export function createApp({ startTime: serverStartTime, deps }: CreateAppOptions): HonoServer {
  const app = new Hono<AppEnv>();

  app.use(timing({ autoEnd: false }));

  /**
   * Routes that stream a stored ebook file. Kept out of both `compress()` and
   * `etag()` — see the notes at each call site.
   */
  const BOOK_DOWNLOAD_PREFIXES = [
    "/library/books/",
    "/opds/books/",
    "/xrpc/buzz.bookhive.getPersonalBookFile",
  ];
  const isBookDownloadPath = (path: string) =>
    BOOK_DOWNLOAD_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
    );

  if (env.isDevelopment) {
    app.use(prettyJSON());
  }
  app.use("*", createContextMiddleware(deps));
  app.use("*", wideEventMiddleware());
  app.use("*", errorCaptureMiddleware());
  app.use("*", async (c, next) => {
    startTime(c, "vite_manifest");
    const manifest = await loadViteManifest();
    const assetUrls = getAssetUrlsFromManifest(manifest);
    // Inline built CSS into <head> to remove the render-blocking stylesheet
    // request from the critical path (improves FCP/LCP). No-op in dev.
    const inlineCss = await getInlineCss(assetUrls);
    c.set("assetUrls", inlineCss ? { ...assetUrls, inlineCss } : assetUrls);
    endTime(c, "vite_manifest");
    await next();
  });
  // secureHeaders() sets `Cross-Origin-Resource-Policy: same-origin` *after*
  // next() returns, which blocks the proxied images from loading cross-origin
  // (the `/images/*` dev fallback redirects to the source CDN, and the imgproxy
  // responses are loaded by `<img>` tags). This middleware is registered before
  // secureHeaders (so it is the outer one) and overrides CORP after secureHeaders
  // has finished, for image responses only.
  app.use("/images/*", async (c, next) => {
    await next();
    c.header("Cross-Origin-Resource-Policy", "cross-origin");
  });
  app.use(secureHeaders());

  // Wrap compress() to measure time spent in compression
  app.use("*", async (c, next) => {
    startTime(c, "compress");
    await next();
    endTime(c, "compress");
  });
  const compressMiddleware = compress();
  app.use("*", async (c, next) => {
    // Ebook downloads are already-compressed containers (EPUB and CBZ are ZIP,
    // MOBI is its own packing), so gzipping them burns CPU for ~nothing. The
    // one that would actually match hono's compressible-type regex is FB2 —
    // `application/x-fictionbook+xml` hits the `+xml` branch — and compressing
    // it drops the Content-Length a client is driving a progress bar from.
    if (isBookDownloadPath(c.req.path)) return next();
    return compressMiddleware(c, next);
  });

  app.use(jsxRenderer());

  app.use("*", opentelemetryMiddleware());

  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) {
      c.header("Cache-Control", "private, no-store");
    }
  });

  app.get("/healthcheck", (c) =>
    c.json({
      status: "ok",
      sha: process.env["BUILD_SHA"] ?? "dev",
      startedAt: serverStartTime,
      // With SO_REUSEPORT, repeated curls land on different workers — handy
      // for verifying all WEB_CONCURRENCY workers are serving.
      workerIndex: env.WORKER_INDEX || "solo",
    }),
  );

  const { printMetrics, registerMetrics } = prometheus();
  app.use("*", registerMetrics);
  app.get("/metrics", async (c) => {
    // Combine @hono/prometheus default metrics with our custom metrics
    const honoResponse = await printMetrics(c);
    const honoText = await honoResponse.text();
    const customMetrics = registry.format();
    return c.text(honoText + "\n" + customMetrics, 200, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  });

  startRuntimeMetricsCollection();

  app.route("/admin", adminRoutes);
  app.route("/debug", debugRoutes);
  app.route("/import", importRoutes);

  // Kept for HTML, images and OG cards, which are small and benefit from 304s.
  //
  // Not for ebook downloads. hono's etag does `res.clone()` and drains one tee
  // branch through the digest while nothing reads the other, so the entire body
  // is buffered in native memory before a single byte reaches the client —
  // measured at 134 MB of arrayBuffers for a 120 MB download, and it defeats
  // streaming outright. Those routes set their own ETag from the stored
  // contentHash (see streamPersonalBook), so clients keep their 304s.
  //
  // `/import` is listed too, even though mounting it above this line already
  // keeps it out. Relying on mount order alone means a future reorder silently
  // hangs the import SSE stream forever — it never ends, so the digest never
  // completes and no byte is ever flushed. That failure is severe and would
  // look like "import is broken" rather than "etag is misconfigured", so it is
  // worth being order-independent about.
  // The two binary XRPC methods are listed by exact NSID, deliberately not as
  // a `/xrpc/` prefix — that would cost the ~35 JSON methods their 304s. Both
  // set their own ETag, and hono's etag() skips a response that already has
  // one, so this is belt-and-braces: if a future edit drops that header the
  // buffering regression above would otherwise come back silently.
  const ETAG_EXCLUDED_PREFIXES = [
    "/library/books/",
    "/opds/books/",
    "/import",
    "/xrpc/buzz.bookhive.getPersonalBookFile",
    "/xrpc/buzz.bookhive.getPersonalBookCover",
  ];
  const isEtagExcluded = (path: string) =>
    ETAG_EXCLUDED_PREFIXES.some(
      (prefix) =>
        // Exact or path-segment match, so "/importer" wouldn't be caught by
        // "/import" if such a route were ever added.
        path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
    );
  const etagMiddleware = etag();
  app.use("*", async (c, next) => {
    if (isEtagExcluded(c.req.path)) {
      return next();
    }
    return etagMiddleware(c, next);
  });

  // Serve anonymous traffic on bot-heavy public pages from the shared KV page
  // cache (one render per URL per hour serves all workers). Prod-only so page
  // edits show up immediately in dev and tests always exercise live renders.
  if (env.isProd) {
    const pageCache = anonPageCache(deps.kv);
    // Note: in Hono, "/explore/*" also matches "/explore" itself.
    app.use("/books/*", pageCache);
    app.use("/explore/*", pageCache);
    app.use("/authors/*", pageCache);
  }

  app.route("/", mainRouter(deps));

  // Sitemap
  app.get("/sitemap.xml", async (c) => {
    const baseUrl = new URL(c.req.url).origin;
    const currentDate = new Date().toISOString();

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/app</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy-policy</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`;

    return c.text(sitemap, 200, {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
    });
  });

  // 404 handler
  app.notFound((c) => c.json({ message: "Not Found" }, 404));

  return app as HonoServer;
}

export type AppType = ReturnType<typeof createApp>;

export default createApp;
