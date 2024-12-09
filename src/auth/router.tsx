import { isValidHandle } from "@atproto/syntax";
import { getIronSession } from "iron-session";

import { OAuthResolverError } from "@atproto/oauth-client-node";
import { env } from "../env";
import type { AppContext, HonoServer, Session } from "../index";
import { Layout } from "../pages/layout";

import { Error } from "../pages/error";
import { Login } from "../pages/login";
import { Agent } from "@atproto/api";

export function loginRouter(
  app: HonoServer,
  {
    onLogin = async () => {},
    onLogout = async () => {},
  }: {
    onLogin?: (ctx: { agent: Agent | null; ctx: AppContext }) => Promise<void>;
    onLogout?: (ctx: { agent: Agent | null; ctx: AppContext }) => Promise<void>;
  } = {},
) {
  // OAuth metadata
  app.get("/client-metadata.json", async (c) => {
    return c.json(c.get("ctx").oauthClient.clientMetadata);
  });

  // OAuth callback to complete session creation
  app.get("/oauth/callback", async (c) => {
    const params = new URLSearchParams(c.req.url.split("?")[1]);
    try {
      const { session } = await c.get("ctx").oauthClient.callback(params);
      const clientSession = await getIronSession<Session>(c.req.raw, c.res, {
        cookieName: "sid",
        password: env.COOKIE_SECRET,
      });
      // assert(!clientSession.did, "session already exists");
      clientSession.did = session.did;
      await clientSession.save();

      const oauthSession = await c.get("ctx").oauthClient.restore(session.did);
      const agent = oauthSession ? new Agent(oauthSession) : null;
      await onLogin({ agent, ctx: c.get("ctx") });

      return c.redirect("/");
    } catch (err) {
      c.get("ctx").logger.error({ err }, "oauth callback failed");
      return c.html(
        <Layout>
          <Login error={`Login failed: ${(err as Error).message}`} />
        </Layout>,
      );
    }
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
          <Login error={"Handle" + handle + "is invalid"} />
        </Layout>,
        400,
      );
    }

    try {
      const url = await c.get("ctx").oauthClient.authorize(handle, {
        scope: "atproto transition:generic",
      });
      return c.redirect(url.toString());
    } catch (err) {
      c.get("ctx").logger.error({ err }, "oauth authorize failed");
      const error =
        err instanceof OAuthResolverError
          ? err.message
          : "Couldn't initiate login";
      return c.html(
        <Layout>
          <Error
            message={error}
            description="Oath authorization failed"
            statusCode={400}
          />
        </Layout>,
        400,
      );
    }
  });

  // Logout handler
  app.post("/logout", async (c) => {
    const session = await getIronSession<Session>(c.req.raw, c.res, {
      cookieName: "sid",
      password: env.COOKIE_SECRET,
    });
    const oauthSession = await c.get("ctx").oauthClient.restore(session.did);
    const agent = oauthSession ? new Agent(oauthSession) : null;
    await onLogout({ agent, ctx: c.get("ctx") });
    await session.destroy();
    return c.redirect("/");
  });
}
