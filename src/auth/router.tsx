import { getIronSession, sealData, type SessionOptions } from "iron-session";

import type { Did } from "@atcute/lexicons";
import { OAuthResolverError } from "@atcute/oauth-node-client";
import { env } from "../env";
import type { AppContext, HonoServer, Session } from "../index";
import { Layout } from "../pages/layout";

import { Error } from "../pages/error";
import { Login } from "../pages/login";
import {
  OAUTH_SCOPES,
  sessionClientFromOAuthSession,
  type SessionClient,
} from "./client";
import { isValidHandle } from "./handle";

// Helper function to get consistent session configuration
export function getSessionConfig(): SessionOptions {
  return {
    cookieName: "sid",
    password: env.COOKIE_SECRET,
    ttl: 60 * 60 * 24, // 24 hours
    cookieOptions: {
      // For localhost development, we need to disable secure flag
      secure: env.NODE_ENV === "production",
      // Ensure SameSite is set to Lax for cross-origin redirects
      sameSite: "lax",
      // Allow cookies to work across localhost ports
      httpOnly: true,
    },
  };
}

export function loginRouter(
  app: HonoServer,
  {
    onLogin = async () => {},
    onLogout = async () => {},
  }: {
    onLogin?: (ctx: {
      agent: SessionClient | null;
      ctx: AppContext;
    }) => Promise<void>;
    onLogout?: (ctx: {
      agent: SessionClient | null;
      ctx: AppContext;
    }) => Promise<void>;
  } = {},
) {
  // OAuth metadata (deprecated)
  app.get("/client-metadata.json", async (c) => {
    return c.json(c.get("ctx").oauthClient.metadata);
  });

  // OAuth metadata
  app.get("/oauth-client-metadata.json", async (c) => {
    return c.json(c.get("ctx").oauthClient.metadata);
  });

  // OAuth callback to complete session creation
  app.get("/oauth/callback", async (c) => {
    const callbackUrl = new URL(c.req.url);
    const params = callbackUrl.searchParams;
    try {
      const { session, state } = await c
        .get("ctx")
        .oauthClient.callback(params);

      const clientSession = await getIronSession<Session>(
        c.req.raw,
        c.res,
        getSessionConfig(),
      );

      clientSession.did = session.did as string;
      await clientSession.save();

      const agent = sessionClientFromOAuthSession(session);
      await onLogin({ agent, ctx: c.get("ctx") });

      if (state && typeof state === "object" && "redirectUri" in state) {
        try {
          const { redirectUri, handle } = state as {
            redirectUri: string;
            handle: string;
          };
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
      try {
        // try using the profile to see if the user actually has valid permissions
        await c.get("ctx").getProfile();
      } catch {
        return c.html(
          <Layout>
            <Login handle={c.req.query("handle")} />
          </Layout>,
        );
      }
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
      const { url } = await c.get("ctx").oauthClient.authorize({
        target: { type: "account", identifier: handle },
        scope: OAUTH_SCOPES,
        state: { redirectUri, handle },
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
      const session = await getIronSession<Session>(
        c.req.raw,
        c.res,
        getSessionConfig(),
      );

      const oauthSession = await c
        .get("ctx")
        .oauthClient.restore(session.did as Did, {
          refresh: "auto",
        });
      await oauthSession.getTokenInfo("auto");
      // Keep session TTL fixed at 24 hours for mobile sessions too
      session.updateConfig(getSessionConfig());
      await session.save();

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
      const { url } = await c.get("ctx").oauthClient.authorize({
        target: { type: "account", identifier: handle },
        scope: OAUTH_SCOPES,
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
    const session = await getIronSession<Session>(
      c.req.raw,
      c.res,
      getSessionConfig(),
    );
    if (session.did) {
      try {
        await c.get("ctx").oauthClient.revoke(session.did as Did);
      } catch {
        // ignore revoke errors
      }
    }
    await onLogout({ agent: null, ctx: c.get("ctx") });
    await session.destroy();
    return c.redirect("/");
  });
}
