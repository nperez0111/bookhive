import { expect, test } from "bun:test";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { timing } from "hono/timing";
import type { AppEnv } from "../context";
import { createTestDb, testContext } from "../test/db";
import { Home } from "./home";

test.each(["reader.test", "handle.invalid"])(
  "home stats link prefers a usable handle: %s",
  async (handle) => {
    const fixture = await createTestDb();
    try {
      const app = new Hono<AppEnv>();
      app.use(timing());
      app.use(jsxRenderer());
      app.use(async (c, next) => {
        c.set(
          "ctx",
          testContext({
            db: fixture.db,
            getProfile: async () => ({
              did: "did:plc:reader",
              handle,
              $type: "app.bsky.actor.defs#profileViewDetailed",
            }),
          }),
        );
        await next();
      });
      app.get("/", (c) => c.render(<Home />, {}));
      const response = await app.request("/");
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(
        `href="/profile/${handle === "reader.test" ? handle : "did:plc:reader"}/stats"`,
      );
      expect(html).not.toContain('href="/profile/handle.invalid');
    } finally {
      await fixture.close();
    }
  },
);
