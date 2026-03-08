/**
 * Main app router: context, auth, layout, images, then domain routes.
 * Composes pages, profile, books, comments, api and xrpc.
 */
import { createIPX, ipxFSStorage, ipxHttpStorage } from "ipx";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { methodOverride } from "hono/method-override";
import { endTime, startTime, timing } from "hono/timing";
import { Hono } from "hono";

import type { AppDeps, AppEnv, HonoServer } from "../context";
import { createContextMiddleware } from "../context";
import { loginRouter } from "../auth/router";
import { Layout } from "../pages/layout";
import { Navbar } from "../pages/navbar";
import { Sidebar } from "../pages/sidebar";
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
import rss from "./rss";

declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title?: string; image?: string; description?: string },
    ): Response;
  }
}

const MAX_AGE = 60 * 60 * 24 * 30;

const ipx = createIPX({
  maxAge: MAX_AGE,
  storage: ipxFSStorage({ dir: "./public" }),
  httpStorage: ipxHttpStorage({
    domains: ["i.gr-assets.com", "cdn.bsky.app"],
    ignoreCacheControl: true,
    maxAge: MAX_AGE,
  }),
});

const FORMAT_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  tiff: "image/tiff",
};

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
          <div class="flex min-h-screen">
            <Sidebar
              currentPath={c.req.path}
              user={
                profileData
                  ? {
                      did: profileData.did,
                      handle: profileData.handle,
                      displayName: profileData.displayName,
                      avatar: profileData.avatar,
                    }
                  : undefined
              }
            />
            <div
              id="sidebar-backdrop"
              class="sidebar-backdrop"
              aria-hidden="true"
            />
            <div class="layout-content flex flex-1 flex-col">
              <Navbar profile={profileData} />
              <main class="flex-1 p-4 lg:p-6">
                <div class="mx-auto max-w-5xl">{children}</div>
              </main>
            </div>
          </div>
        </Layout>
      );
      endTime(c, "layout_render");
      return result;
    }),
  );

  app.use("/images/*", async (c) => {
    // Use pathname only so behavior is identical behind proxies
    const pathname = new URL(c.req.url).pathname;
    const ipxPath = pathname.replace(/^\/images/, "") || "/";

    // Parse IPX URL: /modifiersString/image-id
    const [modifiersString = "_", ...idSegments] = ipxPath.slice(1).split("/");
    // Joining preserves double-slash in https:// URLs (["https:", "", "host"] => "https://host")
    const id = decodeURIComponent(idSegments.join("/"));

    // Parse modifier key=value pairs from the URL segment
    const modifiers: Record<string, string> = Object.create(null);
    if (modifiersString !== "_") {
      for (const p of modifiersString.split(/[&,]/g)) {
        const [key, ...values] = p.split("_");
        if (key) modifiers[key] = values.join("_");
      }
    }

    try {
      const { data, format } = await ipx(id, modifiers).process();
      return new Response(data as BodyInit, {
        headers: {
          "Content-Type": FORMAT_MIME[format ?? ""] ?? "image/jpeg",
          "Cache-Control": `public, max-age=${MAX_AGE}`,
          "X-Request-Id": c.get("requestId"),
        },
      });
    } catch (err) {
      console.error("[IPX] Image processing error:", err);
      return new Response("Image processing error", { status: 500 });
    }
  });

  app.use("/books/:hiveId", methodOverride({ app }));
  app.use("/comments/:commentId", methodOverride({ app }));

  app.route("/", pages);
  app.route("/", profile);
  app.route("/books", books);
  app.route("/comments", comments);
  app.route("/api", api);
  app.route("/rss", rss);

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
