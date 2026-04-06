import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { jsxRenderer } from "hono/jsx-renderer";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { endTime, startTime, timing } from "hono/timing";

import { loadViteManifest, getAssetUrlsFromManifest } from "./utils/manifest";
import { createContextMiddleware, type AppDeps, type AppEnv, type HonoServer } from "./context";
import { env } from "./env";
import { registry, startRuntimeMetricsCollection } from "./metrics";
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

  app.use(timing());

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
    c.set("assetUrls", assetUrls);
    endTime(c, "vite_manifest");
    await next();
  });
  app.use(secureHeaders());

  // Wrap compress() to measure time spent in compression
  app.use("*", async (c, next) => {
    startTime(c, "compress");
    await next();
    endTime(c, "compress");
  });
  app.use(compress());

  app.use(jsxRenderer());

  app.use("*", opentelemetryMiddleware());

  app.get("/healthcheck", (c) => c.text(serverStartTime));

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
