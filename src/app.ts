import { serveStatic } from "hono/bun";
import { prometheus } from "@hono/prometheus";
import { Hono } from "hono";
import { pinoLogger } from "hono-pino";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { jsxRenderer } from "hono/jsx-renderer";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";

import { getBundleAssetUrls } from "./bundle-assets";
import {
  createContextMiddleware,
  type AppDeps,
  type AppEnv,
  type HonoServer,
} from "./context";
import { env } from "./env";
import { opentelemetryMiddleware } from "./middleware/index.ts";
import adminRoutes from "./routes/admin";
import importRoutes from "./routes/import";
import { mainRouter } from "./routes";
import type { Logger } from "pino";

export type CreateAppOptions = {
  logger: Logger;
  startTime: string;
  deps: AppDeps;
};

export function createApp({
  logger,
  startTime,
  deps,
}: CreateAppOptions): HonoServer {
  const app = new Hono<AppEnv>();

  app.use("*", createContextMiddleware(deps));
  app.use("*", async (c, next) => {
    c.set("assetUrls", await getBundleAssetUrls());
    await next();
  });
  app.use(requestId());
  app.use(timing());
  if (env.isDevelopment) {
    app.use(prettyJSON());
  }
  app.use(
    pinoLogger({
      pino: logger,
      http: {
        onResLevel(c) {
          return c.req.path === "/healthcheck" ||
            c.req.path.startsWith("/public") ||
            c.req.path.startsWith("/images")
            ? "trace"
            : "info";
        },
      },
    }),
  );
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

  // TODO enable etag for everything but import route
  app.use(etag());
  app.route("/", mainRouter(deps));

  app.use("/robots.txt", serveStatic({ root: "./public" }));

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

  app.use(
    "/public/*",
    serveStatic({
      root: "./",
      rewriteRequestPath: (path) => path.replace(/^\/static/, "./public"),
    }),
  );

  // 404 handler
  app.notFound((c) => c.json({ message: "Not Found" }, 404));

  return app as HonoServer;
}

export type AppType = ReturnType<typeof createApp>;

export default createApp;
