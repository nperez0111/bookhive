/** @jsx createElement */
// @ts-expect-error
import { createElement } from "hono/jsx";
import assert from "node:assert";
import { TID } from "@atproto/common";
import { isValidHandle } from "@atproto/syntax";
import { getIronSession } from "iron-session";
import type { Hono } from "hono";

import { Agent } from "@atproto/api";
import type { AppContext } from ".";
import { Layout } from "./pages/layout";
import { env } from "./env";
import { OAuthResolverError } from "@atproto/oauth-client-node";

import * as Profile from "./bsky/lexicon/types/app/bsky/actor/profile";
import * as Status from "./bsky/lexicon/types/xyz/statusphere/status";
import { Login } from "./pages/login";
import { Home } from "./pages/home";

type Session = { did: string };

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(req: Request, res: Response, ctx: AppContext) {
  const session = await getIronSession<Session>(req, res, {
    cookieName: "sid",
    password: env.COOKIE_SECRET,
  });

  if (!session.did) {
    return null;
  }

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did);
    return oauthSession ? new Agent(oauthSession) : null;
  } catch (err) {
    ctx.logger.warn({ err }, "oauth restore failed");
    await session.destroy();
    return null;
  }
}

export function createRouter(ctx: AppContext, app: Hono) {
  // OAuth metadata
  app.get("/client-metadata.json", async (c) => {
    return c.json(ctx.oauthClient.clientMetadata);
  });

  // OAuth callback to complete session creation
  app.get("/oauth/callback", async (c) => {
    const params = new URLSearchParams(c.req.url.split("?")[1]);
    try {
      const { session } = await ctx.oauthClient.callback(params);
      const clientSession = await getIronSession<Session>(c.req.raw, c.res, {
        cookieName: "sid",
        password: env.COOKIE_SECRET,
      });
      assert(!clientSession.did, "session already exists");
      clientSession.did = session.did;
      await clientSession.save();
    } catch (err) {
      ctx.logger.error({ err }, "oauth callback failed");
      return c.redirect("/?error");
    }
    return c.redirect("/");
  });

  // Login page
  app.get("/login", (c) => {
    return c.html(
      <Layout>
        <Login />
      </Layout>,
    );
  });

  // Login handler
  app.post("/login", async (c) => {
    const { handle } = await c.req.parseBody();
    if (typeof handle !== "string" || !isValidHandle(handle)) {
      return c.html(
        <Layout>
          <Login error="invalid handle" />
        </Layout>,
        400,
      );
    }

    try {
      const url = await ctx.oauthClient.authorize(handle, {
        scope: "atproto transition:generic",
      });
      return c.redirect(url.toString());
    } catch (err) {
      ctx.logger.error({ err }, "oauth authorize failed");
      const error =
        err instanceof OAuthResolverError
          ? err.message
          : "couldn't initiate login";
      return c.html(
        <Layout>
          <Login error={error} />
        </Layout>,
      );
    }
  });

  // Logout handler
  app.post("/logout", async (c) => {
    const session = await getIronSession<Session>(c.req.raw, c.res, {
      cookieName: "sid",
      password: env.COOKIE_SECRET,
    });
    await session.destroy();
    return c.redirect("/");
  });

  // Homepage (improved version)
  app.get("/", async (c) => {
    const agent = await getSessionAgent(c.req.raw, c.res, ctx);

    const statuses = await ctx.db
      .selectFrom("status")
      .selectAll()
      .orderBy("indexedAt", "desc")
      .limit(10)
      .execute();

    const myStatus = agent
      ? await ctx.db
          .selectFrom("status")
          .selectAll()
          .where("authorDid", "=", agent.assertDid)
          .orderBy("indexedAt", "desc")
          .executeTakeFirst()
      : undefined;

    const didHandleMap = await ctx.resolver.resolveDidsToHandles(
      statuses.map((s) => s.authorDid),
    );

    if (!agent) {
      return c.html(
        <Layout>
          <Home statuses={statuses} didHandleMap={didHandleMap} />
        </Layout>,
      );
    }

    const { data: profileRecord } = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: "app.bsky.actor.profile",
      rkey: "self",
    });

    const profile =
      Profile.isRecord(profileRecord.value) &&
      Profile.validateRecord(profileRecord.value).success
        ? profileRecord.value
        : {};

    return c.html(
      <Layout>
        <Home
          statuses={statuses}
          didHandleMap={didHandleMap}
          profile={profile}
          myStatus={myStatus}
        />
      </Layout>,
    );
  });

  // Status posting handler
  app.post("/status", async (c) => {
    const agent = await getSessionAgent(c.req.raw, c.res, ctx);
    if (!agent) {
      return c.html("<h1>Error: Session required</h1>", 401);
    }

    const { status } = await c.req.parseBody();
    const rkey = TID.nextStr();
    const record = {
      $type: "xyz.statusphere.status",
      status,
      createdAt: new Date().toISOString(),
    };

    if (!Status.validateRecord(record).success) {
      return c.html("<h1>Error: Invalid status</h1>", 400);
    }

    try {
      const res = await agent.com.atproto.repo.putRecord({
        repo: agent.assertDid,
        collection: "xyz.statusphere.status",
        rkey,
        record,
        validate: false,
      });

      await ctx.db
        .insertInto("status")
        .values({
          uri: res.data.uri,
          authorDid: agent.assertDid,
          status: record.status as string,
          createdAt: record.createdAt,
          indexedAt: new Date().toISOString(),
        })
        .execute();

      return c.redirect("/");
    } catch (err) {
      ctx.logger.warn({ err }, "failed to write record");
      return c.html("<h1>Error: Failed to write record</h1>", 500);
    }
  });
}
