import { getIronSession, sealData, type SessionOptions } from "iron-session";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { Did } from "@atcute/lexicons";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import { env } from "../env";
import type { AppContext, HonoServer, Session } from "../context";
import { Layout } from "../pages/layout";

import { Error } from "../pages/error";
import { Login } from "../pages/login";
import { Signup } from "../pages/signup";
import { OAUTH_SCOPES, sessionClientFromOAuthSession, type SessionClient } from "./client";
import { isValidHandle } from "./handle";
import {
  isPdsEnabled,
  mintInviteCode,
  createAccount,
  createEmptyProfile,
  uploadBlob,
} from "../pds/client";

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
    onLogin?: (ctx: { agent: SessionClient | null; ctx: AppContext }) => Promise<void>;
    onLogout?: (ctx: { agent: SessionClient | null; ctx: AppContext }) => Promise<void>;
  } = {},
) {
  // OAuth metadata (deprecated)
  app.get("/client-metadata.json", async (c) => {
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.json(c.get("ctx").oauthClient.metadata);
  });

  // OAuth metadata
  app.get("/oauth-client-metadata.json", async (c) => {
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.json(c.get("ctx").oauthClient.metadata);
  });

  // JWKS endpoint for confidential client key verification
  app.get("/jwks.json", (c) => {
    const jwks = c.get("ctx").oauthClient.jwks;
    if (!jwks) return c.notFound();
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    return c.json(jwks);
  });

  // OAuth callback to complete session creation
  app.get("/oauth/callback", async (c) => {
    const callbackUrl = new URL(c.req.url);
    const params = callbackUrl.searchParams;
    try {
      const { session, state } = await c.get("ctx").oauthClient.callback(params);

      const clientSession = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());

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
          if (redirectTo.protocol !== "exp:" && redirectTo.protocol !== "bookhive:") {
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
            await sealData({ did: session.did }, { password: env.COOKIE_SECRET }),
          );

          return c.redirect(redirectTo.toString());
        } catch {
          // ignore
        }
      }

      return c.redirect("/");
    } catch (err: unknown) {
      const errMsg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      c.get("ctx").addWideEventContext({
        oauth_callback: "failed",
        error: errMsg,
      });
      return c.html(
        <Layout>
          <Login
            error={`Login failed: ${errMsg}`}
            signupUrl={isPdsEnabled() ? "/pds/signup" : "https://bsky.app"}
          />
        </Layout>,
      );
    }
  });

  // Login page
  app.get("/login", async (c) => {
    const signupUrl = isPdsEnabled() ? "/pds/signup" : "https://bsky.app";
    const agent = await c.get("ctx").getSessionAgent();
    if (agent) {
      try {
        // try using the profile to see if the user actually has valid permissions
        await c.get("ctx").getProfile();
      } catch {
        return c.html(
          <Layout assetUrls={c.get("assetUrls")}>
            <Login handle={c.req.query("handle")} signupUrl={signupUrl} />
          </Layout>,
        );
      }
      return c.redirect("/");
    }
    return c.html(
      <Layout assetUrls={c.get("assetUrls")}>
        <Login handle={c.req.query("handle")} signupUrl={signupUrl} />
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
    } catch (err: unknown) {
      const errMsg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't initiate login";
      c.get("ctx").addWideEventContext({
        oauth_authorize: "failed",
        error: errMsg,
      });

      return c.html(
        <Layout>
          <Error message={errMsg} description="Oauth authorization failed" statusCode={400} />
        </Layout>,
        400,
      );
    }
  });

  app.get("/mobile/refresh-token", async (c) => {
    try {
      const session = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());

      const oauthSession = await c.get("ctx").oauthClient.restore(session.did as Did, {
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
          sid: await sealData({ did: session.did }, { password: env.COOKIE_SECRET }),
        },
      });
    } catch {
      return c.json({ success: false }, 400);
    }
  });

  // Signup page
  app.get("/pds/signup", async (c) => {
    if (!isPdsEnabled()) {
      return c.redirect("https://bsky.app");
    }
    const agent = await c.get("ctx").getSessionAgent();
    if (agent) {
      return c.redirect("/");
    }
    return c.html(
      <Layout assetUrls={c.get("assetUrls")}>
        <Signup />
      </Layout>,
    );
  });

  const signupSchema = z
    .object({
      email: z.string().email("Please enter a valid email address."),
      handle: z
        .string()
        .regex(
          /^[a-zA-Z0-9-]{3,20}$/,
          "Handle must be 3-20 characters, letters, numbers, and hyphens only.",
        )
        .transform((h) => h.toLowerCase()),
      password: z.string().min(8, "Password must be at least 8 characters."),
      confirmPassword: z.string(),
      avatar: z.preprocess(
        (v) => (v instanceof File && v.size > 0 ? v : undefined),
        z
          .instanceof(File)
          .refine((f) => ["image/png", "image/jpeg"].includes(f.type), {
            message: "Profile photo must be a PNG or JPEG image.",
          })
          .optional(),
      ),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: "Passwords do not match.",
      path: ["confirmPassword"],
    });

  // Signup handler
  app.post(
    "/pds/signup",
    zValidator("form", signupSchema, (result, c) => {
      if (!result.success) {
        const error = result.error.errors[0]?.message ?? "Invalid input.";
        return c.html(
          <Layout assetUrls={c.get("assetUrls")}>
            <Signup error={error} />
          </Layout>,
          400,
        );
      }
      return undefined;
    }),
    async (c) => {
      if (!isPdsEnabled()) {
        return c.redirect("/login");
      }

      const { email, handle, password, avatar } = c.req.valid("form");
      const fullHandle = `${handle}.bookhive.social`;

      try {
        // 1. Mint an invite code
        const inviteCode = await mintInviteCode();

        // 2. Create the account on the PDS
        const account = await createAccount({
          email,
          handle: fullHandle,
          password,
          inviteCode,
        });

        // 3. Upload avatar blob if provided
        const avatarBlob = avatar
          ? await uploadBlob(account.accessJwt, avatar, avatar.type || "image/jpeg")
          : undefined;

        // 4. Create profile (with optional avatar)
        await createEmptyProfile(account.accessJwt, account.did, avatarBlob);

        // 5. Kick off OAuth flow — user signs in with their new handle/password
        const { url } = await c.get("ctx").oauthClient.authorize({
          target: {
            type: "account",
            identifier: fullHandle as ActorIdentifier,
          },
          scope: OAUTH_SCOPES,
        });
        return c.redirect(url.toString());
      } catch (err: unknown) {
        c.get("ctx").addWideEventContext({ signup: "failed", error: err });
        const errMsg =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        return c.html(
          <Layout assetUrls={c.get("assetUrls")}>
            <Signup error={errMsg} email={email} handle={handle} />
          </Layout>,
          400,
        );
      }
    },
  );

  // Login handler
  app.post("/login", async (c) => {
    let { handle } = await c.req.parseBody();
    if (typeof handle !== "string" || !isValidHandle(handle)) {
      return c.html(
        <Layout>
          <Login
            handle={typeof handle === "string" ? handle : undefined}
            error={
              "Handle `" + (typeof handle === "string" ? handle : "[unknown]") + "` is invalid"
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
    } catch (err: unknown) {
      const errMsg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't initiate login";
      c.get("ctx").addWideEventContext({
        oauth_authorize: "failed",
        error: errMsg,
      });
      return c.html(
        <Layout>
          <Error message={errMsg} description="OAuth authorization failed" statusCode={400} />
        </Layout>,
        400,
      );
    }
  });

  // Mobile signup handler (JSON API)
  const mobileSignupSchema = z.object({
    email: z.string().email("Please enter a valid email address."),
    handle: z
      .string()
      .regex(
        /^[a-zA-Z0-9-]{3,20}$/,
        "Handle must be 3-20 characters, letters, numbers, and hyphens only.",
      )
      .transform((h) => h.toLowerCase()),
    password: z.string().min(8, "Password must be at least 8 characters."),
  });

  app.post(
    "/mobile/signup",
    zValidator("json", mobileSignupSchema, (result, c) => {
      if (!result.success) {
        const error = result.error.errors[0]?.message ?? "Invalid input.";
        return c.json({ success: false, error }, 400);
      }
      return undefined;
    }),
    async (c) => {
      if (!isPdsEnabled()) {
        return c.json({ success: false, error: "Signup is not available." }, 503);
      }

      const { email, handle, password } = c.req.valid("json");
      const fullHandle = `${handle}.bookhive.social`;

      try {
        const inviteCode = await mintInviteCode();

        const account = await createAccount({
          email,
          handle: fullHandle,
          password,
          inviteCode,
        });

        await createEmptyProfile(account.accessJwt, account.did);

        return c.json({ success: true, handle: fullHandle });
      } catch (err: unknown) {
        c.get("ctx").addWideEventContext({ mobile_signup: "failed", error: err });
        const errMsg =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        return c.json({ success: false, error: errMsg }, 400);
      }
    },
  );

  // Logout handler
  app.post("/logout", async (c) => {
    const session = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());
    if (session.did) {
      try {
        await c.get("ctx").oauthClient.revoke(session.did as Did);
      } catch {
        // ignore revoke errors
      }
    }
    await onLogout({ agent: null, ctx: c.get("ctx") });
    session.destroy();
    return c.redirect("/");
  });
}
