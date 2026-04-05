/**
 * Main app router: context, auth, layout, images, then domain routes.
 * Composes pages, profile, books, comments, api and xrpc.
 */
import { createIPX, ipxFSStorage, ipxHttpStorage } from "ipx";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { methodOverride } from "hono/method-override";
import { endTime, startTime, timing } from "hono/timing";
import { Hono } from "hono";
import { defineCachedFunction } from "ocache";

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

const processImage = defineCachedFunction(
  async (id: string, modifiers: Record<string, string>) => {
    const result = await ipx(id, modifiers).process();
    const data = result.data as Buffer;
    const etag = `"${new Bun.CryptoHasher("sha256").update(data).digest("hex")}"`;
    return { data, format: result.format ?? "", etag };
  },
  { maxAge: 5 * 60, getKey: (id, modifiers) => `${JSON.stringify(modifiers)}:${id}` },
);

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
    return c.html(
      <Layout assetUrls={c.get("assetUrls")}>
        <SimpleNavbar isPds={isPds} />
        <PrivacyPolicy />
      </Layout>,
    );
  });

  app.get("/legal", (c) => {
    const isPds = !c.req.url.startsWith(env.PUBLIC_URL);
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
    startTime(c, "pds_profiles");
    const profiles = dids.length > 0 ? await getProfiles({ ctx: c.get("ctx"), dids }) : [];
    endTime(c, "pds_profiles");
    const db = c.get("ctx").db;
    startTime(c, "pds_book_counts");
    const bookCountRows = await db
      .selectFrom("user_book")
      .select((eb) => ["userDid", eb.fn.countAll<number>().as("count")])
      .where("userDid", "in", dids.length > 0 ? dids : [""])
      .groupBy("userDid")
      .execute();
    endTime(c, "pds_book_counts");
    const bookCounts = Object.fromEntries(bookCountRows.map((r) => [r.userDid, r.count]));
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
    startTime(c, "marketing_profile_check");
    const profile = await c.get("ctx").getProfile();
    endTime(c, "marketing_profile_check");
    if (profile) {
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
      const { data, format, etag } = await processImage(id, modifiers);

      if (c.req.header("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }

      return new Response(data as BodyInit, {
        headers: {
          "Content-Type": FORMAT_MIME[format] ?? "image/jpeg",
          "Cache-Control": `public, max-age=${MAX_AGE}`,
          "Content-Length": data.byteLength.toString(),
          ETag: etag,
          "X-Request-Id": c.get("requestId"),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      c.get("appLogger").warn({ msg: "image_proxy_error", image_id: id, error: message });
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
