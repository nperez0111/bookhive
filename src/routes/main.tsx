/**
 * Main app router: context, auth, layout, images, then domain routes.
 * Composes pages, profile, books, comments, api and xrpc.
 */
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { methodOverride } from "hono/method-override";
import { endTime, startTime, timing } from "hono/timing";
import { Hono } from "hono";

import type { AppDeps, AppEnv, HonoServer } from "../context";
import { BookFields } from "../db";
import { createContextMiddleware } from "../context";
import { loginRouter } from "../auth/router";
import { Layout } from "../pages/layout";
import { Navbar } from "../pages/navbar";
import { Sidebar } from "../pages/sidebar";
import { getProfile, getProfiles } from "../utils/getProfile";
import { readThroughCache } from "../utils/readThroughCache";
import { isPdsEnabled, listRepos } from "../pds/client";
import { PdsLanding } from "../pages/pds";
import { PrivacyPolicy } from "../pages/privacy-policy";
import { Terms } from "../pages/terms";
import { SimpleNavbar } from "../pages/simple-navbar";
import { MarketingPage } from "../pages/marketing";
import { env } from "../env";
import {
  buildImgproxyUrl,
  isAllowedImageSource,
  parseImagePath,
  parseModifiers,
} from "../utils/imageProxy";
import { createXrpcRouter } from "../xrpc/router";
import {
  searchBooks,
  ensureBookIdentifiersCurrent,
  refetchBooks,
  refetchBuzzes,
  refetchLists,
  syncFollowsIfNeeded,
} from "./lib";
import pages from "./pages";
import profile from "./profile";
import books from "./books";
import comments from "./comments";
import api from "./api";
import rss from "./rss";
import settings from "./settings";
import og from "./og";
import shelves from "./shelves";

declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title?: string; image?: string; description?: string },
    ): Response;
  }
}

// Public cache lifetime for proxied images (Cloudflare edge + browser).
const IMAGE_MAX_AGE = 60 * 60 * 24 * 30;

export function mainRouter(deps: AppDeps): HonoServer {
  const app = new Hono<AppEnv>();

  // Ensure timing/metric is available for startTime/endTime in routes and layout (parent timing() may not run before this sub-app in some paths)
  app.use(timing());
  app.use("*", createContextMiddleware(deps));

  loginRouter(app, {
    onLogin: async ({ agent, ctx }) => {
      if (!agent) return;
      void Promise.all([
        refetchBooks({ agent, ctx }).then(() => refetchBuzzes({ agent, ctx })),
        syncFollowsIfNeeded({ agent, ctx }),
        refetchLists({ agent, ctx }),
      ]);
    },
  });

  // Standalone pages (no sidebar/navbar) — must be registered before jsxRenderer
  app.get("/privacy-policy", (c) => {
    const isPds = !c.req.url.startsWith(env.PUBLIC_URL);
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.html(
      <Layout assetUrls={c.get("assetUrls")}>
        <SimpleNavbar isPds={isPds} />
        <PrivacyPolicy />
      </Layout>,
    );
  });

  app.get("/legal", (c) => {
    const isPds = !c.req.url.startsWith(env.PUBLIC_URL);
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.html(
      <Layout assetUrls={c.get("assetUrls")}>
        <SimpleNavbar isPds={isPds} />
        <Terms />
      </Layout>,
    );
  });

  app.get("/pds", async (c) => {
    if (!isPdsEnabled()) {
      return c.redirect("/");
    }
    const isPds = !c.req.url.startsWith(env.PUBLIC_URL);
    startTime(c, "pds_list_repos");
    const dids = await listRepos();
    endTime(c, "pds_list_repos");
    const db = c.get("ctx").db;
    startTime(c, "pds_profiles+book_counts");
    const [profiles, bookCountRows] = await Promise.all([
      dids.length > 0 ? getProfiles({ ctx: c.get("ctx"), dids }) : [],
      db
        .selectFrom("user_book")
        .select((eb) => ["userDid", eb.fn.countAll<number>().as("count")])
        .where("userDid", "in", dids.length > 0 ? dids : [""])
        .groupBy("userDid")
        .execute(),
    ]);
    endTime(c, "pds_profiles+book_counts");
    const bookCounts = Object.fromEntries(bookCountRows.map((r) => [r.userDid, r.count]));
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return c.html(
      <Layout assetUrls={c.get("assetUrls")}>
        <SimpleNavbar isPds={isPds} />
        <div class="mx-auto max-w-3xl px-4 py-12">
          <PdsLanding profiles={profiles} bookCounts={bookCounts} />
        </div>
      </Layout>,
    );
  });

  // Marketing landing page — standalone, no Navbar/Sidebar
  app.get("/", async (c) => {
    const url = new URL(c.req.raw.url);
    if (url.searchParams.get("app") || url.hostname === "app.bookhive.buzz") {
      return c.redirect("/app");
    }
    startTime(c, "marketing_session_check");
    const did = await c.get("ctx").getSessionDid();
    endTime(c, "marketing_session_check");
    if (did) {
      return c.redirect("/home");
    }
    const signupUrl = isPdsEnabled() ? "/pds/signup" : "https://bsky.app";

    const ctx = c.get("ctx");

    startTime(c, "marketing_data");
    const { trendingBooks, recentRows, didHandleMap, profileByDid } = await readThroughCache(
      ctx.kv as import("unstorage").Storage<any>,
      "marketing:landing",
      async () => {
        // Run trending + recent queries in parallel
        startTime(c, "marketing_trending");
        startTime(c, "marketing_recent");
        const [trendingResult, recent] = await Promise.all([
          (async () => {
            let trending = await ctx.db
              .selectFrom("hive_book as hb")
              .innerJoin("user_book as ub", "hb.id", "ub.hiveId")
              .select([
                "hb.id",
                "hb.title",
                "hb.authors",
                "hb.thumbnail",
                (eb) => eb.fn.count<number>("ub.userDid").distinct().as("readerCount"),
              ])
              .where(
                "ub.createdAt",
                ">",
                new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
              )
              .groupBy("hb.id")
              .orderBy("readerCount", "desc")
              .orderBy("hb.ratingsCount", "desc")
              .limit(10)
              .execute();

            // Fallback to all-time most-read if not enough recent activity
            if (trending.length < 10) {
              trending = await ctx.db
                .selectFrom("hive_book as hb")
                .innerJoin("user_book as ub", "hb.id", "ub.hiveId")
                .select([
                  "hb.id",
                  "hb.title",
                  "hb.authors",
                  "hb.thumbnail",
                  (eb) => eb.fn.count<number>("ub.userDid").distinct().as("readerCount"),
                ])
                .groupBy("hb.id")
                .orderBy("readerCount", "desc")
                .limit(10)
                .execute();
            }
            return trending;
          })(),
          ctx.db
            .selectFrom("user_book")
            .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
            .select(BookFields)
            .orderBy("user_book.createdAt", "desc")
            .limit(10)
            .execute(),
        ]);
        endTime(c, "marketing_trending");
        endTime(c, "marketing_recent");
        const trending = trendingResult;

        const allDids = [...new Set(recent.map((r) => r.userDid))];
        startTime(c, "marketing_handles");
        startTime(c, "marketing_profiles");
        const [handleMap, profiles] = await Promise.all([
          allDids.length > 0
            ? ctx.resolver.resolveDidsToHandles(allDids)
            : ({} as Record<string, string>),
          allDids.length > 0 ? getProfiles({ ctx, dids: allDids }) : [],
        ]);
        endTime(c, "marketing_handles");
        endTime(c, "marketing_profiles");

        return {
          trendingBooks: trending,
          recentRows: recent,
          didHandleMap: handleMap,
          profileByDid: Object.fromEntries(profiles.map((p) => [p.did, p])),
        };
      },
      { trendingBooks: [], recentRows: [], didHandleMap: {}, profileByDid: {} },
      { ttl: 3_600_000 }, // 1 hour
    );
    endTime(c, "marketing_data");

    startTime(c, "marketing_render");
    const html = (
      <Layout
        assetUrls={c.get("assetUrls")}
        url={c.req.url}
        title="BookHive — Reading is better together"
        description="Track your books, connect with friends, and discover your next favourite read on an open, social platform."
        image="/og/marketing"
      >
        <MarketingPage
          signupUrl={signupUrl}
          recentActivity={recentRows}
          didHandleMap={didHandleMap}
          profileByDid={profileByDid}
          trendingBooks={trendingBooks}
        />
      </Layout>
    );
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=600");
    const response = c.html(html);
    endTime(c, "marketing_render");
    return response;
  });

  app.use(
    jsxRenderer(async ({ children, Layout: _Layout, ...props }) => {
      const c = useRequestContext();
      startTime(c, "layout_get_profile");
      const profileData = await c.get("ctx").getProfile();
      endTime(c, "layout_get_profile");
      startTime(c, "layout_render");
      const result = (
        <Layout {...props} assetUrls={c.get("assetUrls") ?? undefined} url={c.req.url}>
          <div class="flex min-h-screen">
            <Sidebar
              currentPath={c.req.path}
              pdsEnabled={isPdsEnabled()}
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
            <div id="sidebar-backdrop" class="sidebar-backdrop" aria-hidden="true" />
            <div class="layout-content flex flex-1 flex-col">
              <Navbar profile={profileData} />
              <main class="flex-1 overflow-x-auto flex justify-center">
                <div class="mx-auto max-w-5xl m-4 lg:m-6">{children}</div>
              </main>
            </div>
          </div>
          <div id="mount-search-palette" data-logged-in={profileData ? "true" : "false"} />
        </Layout>
      );
      endTime(c, "layout_render");
      return result;
    }),
  );

  // Canonical, stable image endpoint. This is a thin signing reverse-proxy in
  // front of imgproxy: it validates the source host, translates the IPX-style
  // modifier string into imgproxy options, signs the URL server-side, fetches
  // the processed image and streams it back. The `/images/{modifiers}/{source}`
  // grammar is a stable public contract (web, OG, and iOS depend on it), so the
  // imgproxy provider can be swapped out later without breaking any URLs.
  app.use("/images/*", async (c) => {
    // Use pathname only so behavior is identical behind proxies
    const pathname = new URL(c.req.url).pathname;
    const { modifiersString, id } = parseImagePath(pathname);

    const modifiers = parseModifiers(modifiersString);

    const svgFallback = () => {
      // Return an SVG fallback — user silhouette for avatars, book placeholder otherwise
      const isAvatar = id.includes("/img/avatar/") || id.includes("avatar");
      const fallbackSvg = isAvatar
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
            <rect width="100" height="100" fill="#fef3c7"/>
            <circle cx="50" cy="38" r="18" fill="#d97706"/>
            <path d="M14 85c0-19.9 16.1-36 36-36s36 16.1 36 36" fill="#d97706"/>
          </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" fill="none">
            <rect width="100" height="140" rx="4" fill="#fef3c7"/>
            <rect x="20" y="30" width="60" height="6" rx="3" fill="#d97706" opacity=".5"/>
            <rect x="20" y="46" width="45" height="6" rx="3" fill="#d97706" opacity=".35"/>
            <rect x="20" y="62" width="52" height="6" rx="3" fill="#d97706" opacity=".35"/>
          </svg>`;
      return new Response(fallbackSvg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=60",
          "X-Request-Id": c.get("requestId"),
        },
      });
    };

    // Only remote sources on the allowlist are proxied. Local/static images are
    // served directly (never routed through here).
    if (!isAllowedImageSource(id)) {
      c.get("appLogger").warn({ msg: "image_proxy_forbidden_source", image_id: id });
      return svgFallback();
    }

    // When imgproxy isn't configured (e.g. local dev), fall back to redirecting
    // to the source so images still render.
    if (!env.IMGPROXY_URL) {
      return c.redirect(id, 302);
    }

    try {
      const imgproxyUrl = buildImgproxyUrl(id, modifiers);
      const upstream = await fetch(imgproxyUrl, {
        headers: c.req.header("If-None-Match")
          ? { "If-None-Match": c.req.header("If-None-Match")! }
          : undefined,
      });

      if (upstream.status === 304) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: upstream.headers.get("ETag") ?? "",
            "X-Request-Id": c.get("requestId"),
          },
        });
      }

      if (!upstream.ok || !upstream.body) {
        throw new Error(`imgproxy ${upstream.status}`);
      }

      const headers = new Headers();
      headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "image/jpeg");
      headers.set("Cache-Control", `public, max-age=${IMAGE_MAX_AGE}`);
      const etag = upstream.headers.get("ETag");
      if (etag) headers.set("ETag", etag);
      const contentLength = upstream.headers.get("Content-Length");
      if (contentLength) headers.set("Content-Length", contentLength);
      headers.set("X-Request-Id", c.get("requestId"));

      return new Response(upstream.body, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      c.get("appLogger").warn({ msg: "image_proxy_error", image_id: id, error: message });
      return svgFallback();
    }
  });

  app.use("/books/:hiveId", methodOverride({ app }));
  app.use("/comments/:commentId", methodOverride({ app }));

  app.route("/", pages);
  app.route("/", profile);
  app.route("/books", books);
  app.route("/shelves", shelves);
  app.route("/comments", comments);
  app.route("/api", api);
  app.route("/settings", settings);
  app.route("/rss", rss);
  app.route("/og", og);

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
