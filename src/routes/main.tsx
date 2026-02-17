/**
 * Main app router: context, auth, layout, images, then domain routes.
 * Composes pages, profile, books, comments, api and xrpc.
 */
import {
  createIPX,
  createIPXFetchHandler,
  ipxFSStorage,
  ipxHttpStorage,
} from "ipx";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { methodOverride } from "hono/method-override";
import { endTime, startTime, timing } from "hono/timing";
import { Hono } from "hono";

import type { AppDeps, AppEnv, HonoServer } from "../context";
import { createContextMiddleware } from "../context";
import { loginRouter } from "../auth/router";
import { Layout } from "../pages/layout";
import { Navbar } from "../pages/navbar";
import { getProfile } from "../utils/getProfile";
import { createXrpcRouter } from "../xrpc/router";
import {
  searchBooks,
  ensureBookIdentifiersCurrent,
  refetchBuzzes,
  refetchBooks,
  syncFollowsIfNeeded,
} from "./lib";
import pages from "./pages";
import profile from "./profile";
import books from "./books";
import comments from "./comments";
import api from "./api";

declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title?: string; image?: string; description?: string },
    ): Response;
  }
}

const ipxHandler = createIPXFetchHandler(
  createIPX({
    maxAge: 60 * 60 * 24 * 30,
    storage: ipxFSStorage({ dir: "./public" }),
    httpStorage: ipxHttpStorage({
      domains: ["i.gr-assets.com", "cdn.bsky.app"],
      ignoreCacheControl: true,
      maxAge: 60 * 60 * 24 * 30,
    }),
  }),
);

export function mainRouter(deps: AppDeps): HonoServer {
  const app = new Hono<AppEnv>();

  // Ensure timing/metric is available for startTime/endTime in routes and layout (parent timing() may not run before this sub-app in some paths)
  app.use(timing());
  app.use("*", createContextMiddleware(deps));

  loginRouter(app, {
    onLogin: async ({ agent, ctx }) => {
      if (!agent) return;
      await Promise.race([
        Promise.all([
          refetchBooks({ agent, ctx }).then(() =>
            refetchBuzzes({ agent, ctx }),
          ),
          syncFollowsIfNeeded({ agent, ctx }),
        ]),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    },
  });

  app.use(
    jsxRenderer(async ({ children, Layout: _Layout, ...props }) => {
      const c = useRequestContext();
      startTime(c, "layout_get_profile");
      const profileData = await c.get("ctx").getProfile();
      endTime(c, "layout_get_profile");
      startTime(c, "layout_render");
      const result = (
        <Layout
          {...props}
          assetUrls={c.get("assetUrls") ?? undefined}
          url={c.req.url}
        >
          <Navbar profile={profileData} />
          <div class="relative">{children}</div>
        </Layout>
      );
      endTime(c, "layout_render");
      return result;
    }),
  );

  app.use("/images/*", async (c) => {
    // Use pathname only so behavior is identical behind proxies (fixes production IPX errors)
    const pathname = new URL(c.req.url).pathname;
    const ipxPath = pathname.replace(/^\/images/, "") || "/";
    const ipxUrl = new URL(ipxPath, "http://localhost").href;
    const res = await ipxHandler(ipxUrl);
    const headers = new Headers(res.headers);
    headers.set("X-Request-Id", c.get("requestId"));
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  });

  app.use("/books/:hiveId", methodOverride({ app }));
  app.use("/comments/:commentId", methodOverride({ app }));

  app.route("/", pages);
  app.route("/", profile);
  app.route("/books", books);
  app.route("/comments", comments);
  app.route("/api", api);

  createXrpcRouter(app, {
    searchBooks,
    ensureBookIdentifiersCurrent,
    getProfile,
  });

  return app as HonoServer;
}

/** @deprecated Use mainRouter(deps) and app.route("/", mainRouter(deps)) instead. */
export function createRouter(app: HonoServer, deps: AppDeps): void {
  app.route("/", mainRouter(deps));
}
