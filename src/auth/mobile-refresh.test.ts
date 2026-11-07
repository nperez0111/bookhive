import { beforeEach, expect, it } from "bun:test";
import { Hono } from "hono";
import { sealData } from "iron-session";
import { createStorage } from "unstorage";
import type { AppContext, HonoServer } from "../context";
import { env } from "../env";
import { loginRouter } from "./router";
import { resetRestoreGuards, restoreGuardStates } from "./restore-guard";
import { TokenRefreshError, TokenInvalidError } from "@atcute/oauth-node-client";

beforeEach(resetRestoreGuards);

function mobileApp(restore: () => Promise<unknown>) {
  const app = new Hono() as HonoServer;
  const kv = createStorage();
  const ctx = {
    kv,
    oauthClient: { restore },
    addWideEventContext: () => {},
  } as unknown as AppContext;
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  loginRouter(app);
  return { app, kv };
}

async function cookie() {
  return `sid=${await sealData({ did: "did:plc:test" }, { password: env.COOKIE_SECRET })}`;
}

it("returns 401 for a missing mobile session without contacting OAuth", async () => {
  let called = false;
  const { app } = mobileApp(async () => {
    called = true;
  });
  const response = await app.request("/mobile/refresh-token");
  expect(response.status).toBe(401);
  expect(called).toBe(false);
});

it("returns transient 503, not an auth rejection, for PDS outages", async () => {
  const { app, kv } = mobileApp(async () => {
    throw new Error("Unable to connect");
  });
  await kv.set("auth_session:did:plc:test", { tokenSet: { iss: "https://pds.test" } });
  const response = await app.request("/mobile/refresh-token", {
    headers: { cookie: await cookie() },
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ success: false, error: "SessionUnavailable" });
  expect(restoreGuardStates()[0]?.key).toBe("pds.test");
});

it("returns terminal 401 when the refresh grant was revoked", async () => {
  const { app } = mobileApp(async () => {
    throw new Error("invalid_grant");
  });
  const response = await app.request("/mobile/refresh-token", {
    headers: { cookie: await cookie() },
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ success: false, error: "SessionExpired" });
});

it("renews a healthy mobile session", async () => {
  const { app } = mobileApp(async () => ({ getTokenInfo: async () => ({}) }));
  const response = await app.request("/mobile/refresh-token", {
    headers: { cookie: await cookie() },
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.payload.did).toBe("did:plc:test");
  expect(typeof body.payload.sid).toBe("string");
});

it.each([
  new TokenRefreshError("did:plc:test", "session was deleted by another process"),
  new TokenRefreshError("did:plc:test", "no refresh token available"),
  new TokenInvalidError("did:plc:test"),
])("destroys a terminal SDK mobile session: %s", async (error) => {
  const { app } = mobileApp(async () => {
    throw error;
  });
  const response = await app.request("/mobile/refresh-token", {
    headers: { cookie: await cookie() },
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ success: false, error: "SessionExpired" });
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});

it("preserves the cookie for a transient SDK timeout", async () => {
  const { app } = mobileApp(async () => {
    throw new DOMException("Timed out", "TimeoutError");
  });
  const response = await app.request("/mobile/refresh-token", {
    headers: { cookie: await cookie() },
  });
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("validates mobile login redirect destinations before initiating OAuth", async () => {
  const { app } = mobileApp(async () => ({}));
  const response = await app.request(
    "/mobile/login?handle=test.bsky.social&redirect_uri=https://evil.test",
  );
  expect(response.status).toBe(400);
});
