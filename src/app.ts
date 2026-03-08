import { join } from "path";
import { serveStatic } from "hono/bun";
import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { jsxRenderer } from "hono/jsx-renderer";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";

import { loadViteManifest, getAssetUrlsFromManifest } from "./utils/manifest";
import { createContextMiddleware, type AppDeps, type AppEnv, type HonoServer } from "./context";
import { env } from "./env";
import { errorCaptureMiddleware } from "./middleware/error-capture";
import { opentelemetryMiddleware } from "./middleware/index.ts";
import { wideEventMiddleware } from "./middleware/wide-event";
import adminRoutes from "./routes/admin";
import importRoutes from "./routes/import";
import { feedGeneratorRouter } from "./routes/feedGenerator";
import { mainRouter } from "./routes";

export type CreateAppOptions = {
  startTime: string;
  deps: AppDeps;
  /** In production, root dir for built assets (public or dist/public). Resolved when running from dist/ (Docker) vs repo root. */
  productionPublicRoot?: string;
};

export function createApp({ startTime, deps, productionPublicRoot }: CreateAppOptions): HonoServer {
  const app = new Hono<AppEnv>();
  const assetRoot = productionPublicRoot ?? (env.isProduction ? "dist/public" : "public");

  app.use(timing());
  if (env.isDevelopment) {
    app.use(prettyJSON());
  }
  app.use("*", createContextMiddleware(deps));
  app.use("*", wideEventMiddleware());
  app.use("*", errorCaptureMiddleware());
  app.use("*", async (c, next) => {
    const manifest = await loadViteManifest();
    const assetUrls = getAssetUrlsFromManifest(manifest);
    c.set("assetUrls", assetUrls);
    await next();
  });
  app.use(secureHeaders());
  app.use(compress());
  app.use(jsxRenderer());

  app.use("*", opentelemetryMiddleware());

  app.get("/healthcheck", (c) => c.text(startTime));

  const { printMetrics, registerMetrics } = prometheus();
  app.use("*", registerMetrics);
  app.get("/metrics", printMetrics);

  app.route("/admin", adminRoutes);
  app.route("/import", importRoutes);
  app.route("/", feedGeneratorRouter());

  // Static assets before main router so /assets and /public are served first
  const publicRoot = env.isProduction
    ? join(process.cwd(), assetRoot)
    : join(process.cwd(), "public");
  app.use("/robots.txt", serveStatic({ root: publicRoot }));
  app.get("/favicon.ico", serveStatic({ root: publicRoot }));
  if (env.isProduction) {
    app.use(
      "/assets/*",
      serveStatic({
        root: publicRoot,
        rewriteRequestPath: (path) => (path.startsWith("/assets") ? path.slice(1) : path),
      }),
    );
  }
  // Serve static files at root (e.g. /hive.jpg, /book.svg) — Vite serves public at / in dev
  const staticExt = /\.(jpg|jpeg|png|gif|svg|ico|webmanifest|js|css|woff2?|webp)$/i;
  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (staticExt.test(path)) {
      return serveStatic({ root: publicRoot })(c, next);
    }
    return next();
  });

  // TODO enable etag for everything but import route
  app.use(etag());
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
    });
  });

  // 404 handler
  app.notFound((c) => c.json({ message: "Not Found" }, 404));

  return app as HonoServer;
}

export type AppType = ReturnType<typeof createApp>;

export default createApp;
