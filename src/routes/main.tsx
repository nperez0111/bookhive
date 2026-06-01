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
  parseImagePath,
  parseModifiers,
  proxyImageResponse,
  queryToModifiers,
} from "../utils/imageProxy";
import type { HiveId } from "../types";
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

  // --- Canonical, stable image endpoints (signing reverse-proxy to imgproxy) ---
  //
  // Two URL shapes share the same proxy logic (`proxyImageResponse`):
  //
  //  1. ID-keyed (preferred): `/images/books/:hiveId?w=440` and
  //     `/images/avatars/:did?s=120`. The source is resolved at request time
  //     from our own data (hive_book / profile), so the URL is permanently
  //     stable and never leaks the upstream provider — swap providers freely.
  //  2. Source-embedded: `/images/{modifiers}/{source}` — stateless, used by OG
  //     render + iOS. Still a stable public contract.
  //
  // These specific routes MUST be registered before the catch-all below so they
  // aren't swallowed by `/images/*`.

  // Canonical book cover: resolves hive_book's current cover/thumbnail.
  app.get("/images/books/:hiveId", async (c) => {
    const hiveId = c.req.param("hiveId") as HiveId;
    const book = await c
      .get("ctx")
      .db.selectFrom("hive_book")
      .select(["cover", "thumbnail"])
      .where("id", "=", hiveId)
      .limit(1)
      .executeTakeFirst();
    const source = book?.cover || book?.thumbnail || null;
    // Default to a 440px-wide fit; ?w / ?h / ?s / ?q / ?fit override.
    const modifiers = queryToModifiers(c.req.query(), { w: "440" });
    return proxyImageResponse({
      source,
      modifiers,
      kind: "book",
      ifNoneMatch: c.req.header("If-None-Match"),
      requestId: c.get("requestId"),
      warn: (e) => c.get("appLogger").warn(e),
    });
  });

  // Canonical avatar: resolves the profile's current avatar by DID.
  app.get("/images/avatars/:did", async (c) => {
    const did = c.req.param("did");
    const profile = await getProfile({ ctx: c.get("ctx"), did }).catch(() => null);
    const source = profile?.avatar ?? null;
    // Default to a 120x120 cover crop; ?s / ?w / ?h / ?q / ?fit override.
    const modifiers = queryToModifiers(c.req.query(), { s: "120x120", fit: "cover" });
    return proxyImageResponse({
      source,
      modifiers,
      kind: "avatar",
      ifNoneMatch: c.req.header("If-None-Match"),
      requestId: c.get("requestId"),
      warn: (e) => c.get("appLogger").warn(e),
    });
  });

  // Source-embedded form (OG + iOS): `/images/{modifiers}/{source}`.
  app.use("/images/*", async (c) => {
    // Use pathname only so behavior is identical behind proxies
    const pathname = new URL(c.req.url).pathname;
    const { modifiersString, id } = parseImagePath(pathname);
    const modifiers = parseModifiers(modifiersString);
    const kind = id.includes("/img/avatar/") || id.includes("avatar") ? "avatar" : "book";
    return proxyImageResponse({
      source: id,
      modifiers,
      kind,
      ifNoneMatch: c.req.header("If-None-Match"),
      requestId: c.get("requestId"),
      warn: (e) => c.get("appLogger").warn(e),
    });
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
