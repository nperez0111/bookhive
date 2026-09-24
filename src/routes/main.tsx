/**
 * Main app router: context, auth, layout, images, then domain routes.
 * Composes pages, profile, books, comments, api and xrpc.
 */
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import { methodOverride } from "hono/method-override";
import { endTime, startTime, timing } from "hono/timing";
import { Hono } from "hono";

import type { AppDeps, AppEnv, HonoServer } from "../context";
import { createContextMiddleware } from "../context";
import { loginRouter } from "../auth/router";
import { Layout } from "../pages/layout";
import { type AtTagsProps } from "../pages/components/AtTags";
import { Navbar } from "../pages/navbar";
import { Sidebar } from "../pages/sidebar";
import { getProfile, getProfiles } from "../services/getProfile";
import { isPdsEnabled, listRepos } from "../pds/client";
import { PdsLanding } from "../pages/pds";
import { PrivacyPolicy } from "../pages/privacy-policy";
import { Terms } from "../pages/terms";
import { SimpleNavbar } from "../pages/simple-navbar";
import { MarketingPage } from "../pages/marketing";
import { getCommunityStats } from "../data/communityStats";
import { env } from "../env";
import { parseImagePath, parseModifiers, proxyImageResponse, queryToModifiers } from "./imageProxy";
import type { HiveId } from "../types";
import { createXrpcRouter } from "../xrpc/router";
import { searchBooks } from "../services/searchBooks";
import {
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
import { getLandingHighlights } from "../data/landingHighlights";
import rss from "./rss";
import settings from "./settings";
import og from "./og";
import shelves from "./shelves";
import library from "./library";
import opds from "./opds";
import kosync from "./sync/kosync";

declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: {
        title?: string;
        image?: string;
        description?: string;
        url?: string;
        ogType?: string;
        ogExtra?: unknown;
        atTags?: AtTagsProps;
      },
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
      <Layout assetUrls={c.get("assetUrls")} url={c.req.url}>
        <SimpleNavbar isPds={isPds} />
        <PrivacyPolicy />
      </Layout>,
    );
  });

  app.get("/legal", (c) => {
    const isPds = !c.req.url.startsWith(env.PUBLIC_URL);
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.html(
      <Layout assetUrls={c.get("assetUrls")} url={c.req.url}>
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
      dids.length > 0 ? getProfiles({ ctx: c.get("ctx"), dids, publicOnly: true }) : [],
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
      <Layout assetUrls={c.get("assetUrls")} url={c.req.url}>
        <SimpleNavbar isPds={isPds} />
        <div class="mx-auto max-w-3xl px-4 py-12">
          <PdsLanding profiles={profiles} bookCounts={bookCounts} />
        </div>
      </Layout>,
    );
  });

  // Marketing landing page — standalone, no Navbar/Sidebar.
  //
  // `/` answers two different things under one URL: a 302 to /home when signed
  // in, the marketing page otherwise. That's only safe because the anonymous
  // render carries `Vary: Cookie` (added for all HTML in
  // server/plugins/cache-headers.ts) — without it a browser replays the stored
  // marketing page after sign-in and the redirect never fires. The 302 itself
  // is `private, no-store`.
  app.get("/", async (c) => {
    const url = new URL(c.req.raw.url);
    if (url.searchParams.get("app") || url.hostname === "app.bookhive.buzz") {
      return c.redirect("/app");
    }
    // Cookie-only session read — no OAuth restore, so this costs nothing.
    startTime(c, "marketing_session_check");
    const did = await c.get("ctx").getSessionDid();
    endTime(c, "marketing_session_check");
    if (did) {
      return c.redirect("/home");
    }
    const signupUrl = isPdsEnabled() ? "/pds/signup" : "https://bsky.app";

    const ctx = c.get("ctx");

    const communityStats = await getCommunityStats(ctx.db, ctx.kv);
    startTime(c, "marketing_data");
    const { trendingBooks, recentRows } = await getLandingHighlights({ db: ctx.db, kv: ctx.kv });

    // Profile hydration stays out of the cached aggregate: it's a PDS network
    // call, and caching it alongside the SQL would freeze avatars for a day.
    const allDids = [...new Set(recentRows.map((r) => r.userDid))];
    const [didHandleMap, profiles] = await Promise.all([
      allDids.length > 0
        ? ctx.resolver.resolveDidsToHandles(allDids)
        : Promise.resolve({} as Record<string, string>),
      allDids.length > 0 ? getProfiles({ ctx, dids: allDids, publicOnly: true }) : [],
    ]);
    const profileByDid = Object.fromEntries(profiles.map((p) => [p.did, p]));
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
          communityStats={communityStats}
          signupUrl={signupUrl}
          recentActivity={recentRows}
          didHandleMap={didHandleMap}
          profileByDid={profileByDid}
          trendingBooks={trendingBooks}
        />
      </Layout>
    );
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=600");
    // Belt and braces: nitro adds this to all HTML, but this is the one route
    // whose correctness depends on it, and the bare `bun run src/server.ts`
    // path has no nitro.
    c.header("Vary", "Cookie");
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
            <div class="layout-content flex min-w-0 flex-1 flex-col">
              <Navbar profile={profileData} />
              {/*
                `overflow-x-clip`, never `overflow-x-auto`: `auto` on one axis forces the other to
                compute to `auto` too, turning <main> into a scroll container on BOTH axes, whose
                residual overflow traps the mouse wheel a few px into the page. `overflow-visible`
                isn't an option either — BookTooltip is always rendered (at `opacity-0`), so its
                w-48 box would produce a document-level h-scrollbar. `overflow-clip-margin` widens
                the clip edge so tooltips can still overhang the content column.
              */}
              {/*
                Gutter is padding here, not a margin on the column below — Tailwind v4 emits
                `margin-inline` after `margin`, so a margin there loses to the column's own
                `mx-auto` and computes to 0 below `lg`. Padding can't be overridden that way, and
                still keeps the negative-margin full-bleed sections cancelling exactly.
              */}
              <main class="flex-1 overflow-x-clip [overflow-clip-margin:5rem] flex justify-center px-4 py-4 lg:px-6 lg:py-6">
                {/* `w-full`: without it, this flex item under `justify-center` sizes to
                    max-content, so content-light pages render narrower than max-w-5xl. */}
                <div class="mx-auto w-full min-w-0 max-w-5xl">{children}</div>
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
  //  1. ID-keyed (preferred): `/images/books/:hiveId?w=440` and
  //     `/images/avatars/:did?s=120` — resolved from our own data at request
  //     time, so the URL is permanently stable and never leaks the upstream
  //     provider.
  //  2. Source-embedded: `/images/{modifiers}/{source}` — stateless, used by OG
  //     render + iOS.
  //
  // Both must be registered before the `/images/*` catch-all below.

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
  app.route("/library", library);
  app.route("/opds", opds);
  app.route("/rss", rss);
  app.route("/og", og);
  app.route("/kosync", kosync);

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
