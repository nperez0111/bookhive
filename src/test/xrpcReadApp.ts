import { Hono } from "hono";
import type { AppContext, AppEnv } from "../context";
import { createXrpcRouter } from "../xrpc/router";
import { testContext } from "./db";

/** Read-route tests keep real routing/validation, without catalogue network calls. */
export function xrpcReadApp(overrides: Partial<AppContext> & Pick<AppContext, "db">) {
  const ctx = testContext(overrides);
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  createXrpcRouter(app, {
    searchBooks: async () => [],
    ensureBookIdentifiersCurrent: async () => {},
    getProfile: async () => null,
  });
  return { app, ctx };
}
