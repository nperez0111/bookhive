import { isValidHandle } from "@atproto/syntax";
import { getIronSession, sealData } from "iron-session";
import { differenceInSeconds } from "date-fns";

import { OAuthResolverError } from "@atproto/oauth-client-node";
import { env } from "../env";
import type { AppContext, HonoServer, Session } from "../index";
import { Layout } from "../pages/layout";

import { Agent } from "@atproto/api";
import { Error } from "../pages/error";
import { Login } from "../pages/login";

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
      const { session, state } = await c
        .get("ctx")
        .oauthClient.callback(params);
      const tokenInfo = await session.getTokenInfo(false);

      const clientSession = await getIronSession<Session>(c.req.raw, c.res, {
        cookieName: "sid",
        password: env.COOKIE_SECRET,
        // TODO need to set TTL for session refresh?
        ttl: tokenInfo.expiresAt
          ? differenceInSeconds(tokenInfo.expiresAt, new Date())
          : undefined,
      });

      // assert(!clientSession.did, "session already exists");
      clientSession.did = session.did;
      await clientSession.save();

      const oauthSession = await c.get("ctx").oauthClient.restore(session.did);
      const agent = oauthSession ? new Agent(oauthSession) : null;
      await onLogin({ agent, ctx: c.get("ctx") });

      if (state) {
        try {
          const { redirectUri, handle } = JSON.parse(state);

          const redirectTo = new URL(redirectUri);
          if (
            redirectTo.protocol !== "exp:" &&
            redirectTo.protocol !== "bookhive:"
          ) {
            return c.html(
              <Layout>
                <Error
                  message="Invalid redirect_uri"
                  description="Redirect uri must be an exp or bookhive url"
                  statusCode={400}
                />
              </Layout>,
              400,
            );
          }
          redirectTo.searchParams.set("did", session.did);
          redirectTo.searchParams.set("handle", handle);
          redirectTo.searchParams.set(
            "sid",
            await sealData(
              { did: session.did },
              { password: env.COOKIE_SECRET },
            ),
          );

          return c.redirect(redirectTo.toString());
        } catch (err) {
          // ignore
        }
      }

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
  app.get("/login", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (agent) {
      return c.redirect("/");
    }
    return c.html(
      <Layout>
        <Login handle={c.req.query("handle")} />
      </Layout>,
    );
  });

  app.get("/mobile/login", async (c) => {
    let { handle, redirect_uri: redirectUri } = c.req.query();
    if (typeof handle !== "string" || !isValidHandle(handle)) {
      return c.html(
        <Layout>
          <Login error={"Handle '" + handle + "' is invalid"} />
        </Layout>,
        400,
      );
    }

    try {
      const url = await c.get("ctx").oauthClient.authorize(handle, {
        scope: "atproto transition:generic",
        state: JSON.stringify({ redirectUri, handle }),
      });
      return c.redirect(url.toString());
    } catch (err) {
      c.get("ctx").logger.error({ err }, "oauth authorize failed");

      return c.html(
        <Layout>
          <Error
            message={
              err instanceof OAuthResolverError
                ? err.message
                : "Couldn't initiate login"
            }
            description="Oauth authorization failed"
            statusCode={400}
          />
        </Layout>,
        400,
      );
    }
  });

  app.get("/mobile/refresh-token", async (c) => {
    try {
      const session = await getIronSession<Session>(c.req.raw, c.res, {
        cookieName: "sid",
        password: env.COOKIE_SECRET,
      });

      const oauthSession = await c.get("ctx").oauthClient.restore(session.did);
      const tokenInfo = await oauthSession.getTokenInfo("auto");
      if (tokenInfo && tokenInfo.expiresAt) {
        session.updateConfig({
          cookieName: "sid",
          password: env.COOKIE_SECRET,
          ttl: differenceInSeconds(tokenInfo.expiresAt, new Date()),
        });
        await session.save();
      }

      return c.json({
        success: true,
        payload: {
          did: session.did,
          sid: await sealData(
            { did: session.did },
            { password: env.COOKIE_SECRET },
          ),
        },
      });
    } catch (err) {
      return c.json({ success: false }, 400);
    }
  });

  // Login handler
  app.post("/login", async (c) => {
    let { handle } = await c.req.parseBody();
    if (typeof handle !== "string" || !isValidHandle(handle)) {
      return c.html(
        <Layout>
          <Login
            handle={typeof handle === "string" ? handle : undefined}
            error={
              "Handle `" +
              (typeof handle === "string" ? handle : "[unknown]") +
              "` is invalid"
            }
          />
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
            description="OAuth authorization failed"
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
