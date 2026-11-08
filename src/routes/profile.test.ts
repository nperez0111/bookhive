import { expect, it } from "bun:test";
import { Hono } from "hono";
import { timing } from "hono/timing";
import type { AppContext, AppEnv } from "../context";
import profileRouter from "./profile";
import { createTestDb, testContext } from "../test/db";
import type { SessionClient } from "../auth/client";

it.each(["alice.test", "handle.invalid", null])(
  "profile redirect prefers a usable resolved handle, with DID fallback: %s",
  async (handle) => {
    const app = new Hono<AppEnv>();
    app.use(async (c, next) => {
      c.set("ctx", {
        getSessionAgent: async () => ({ did: "did:plc:alice" }),
        resolver: {
          resolveDidToHandle: async () => {
            if (!handle) throw new Error("resolution unavailable");
            return handle;
          },
        },
      } as unknown as AppContext);
      await next();
    });
    app.route("/", profileRouter);
    const response = await app.request("/profile");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `/profile/${handle === "alice.test" ? handle : "did:plc:alice"}`,
    );
  },
);

it("waits for book sync before returning a failed refresh", async () => {
  let releaseBooks!: () => void;
  const booksPending = new Promise<void>((resolve) => {
    releaseBooks = resolve;
  });
  let responseSettled = false;
  let bookSyncFinished = false;
  const ctx = {
    getSessionAgent: async () => ({
      did: "did:plc:alice",
      get: async (_method: string, { params }: { params: { collection: string } }) => {
        if (params.collection !== "buzz.bookhive.book") throw new Error("Shelf sync failed");
        await booksPending;
        bookSyncFinished = true;
        return { ok: false };
      },
    }),
  } as unknown as AppContext;
  const app = new Hono<AppEnv>();
  app.use(timing());
  app.use(async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  app.onError((error, c) => c.text(error.message, 500));
  app.route("/", profileRouter);

  const pending = Promise.resolve(app.request("/refresh-books")).then((response) => {
    responseSettled = true;
    return response;
  });
  try {
    await Bun.sleep(10);
    expect(responseSettled).toBe(false);
  } finally {
    releaseBooks();
  }
  const response = await pending;
  expect(bookSyncFinished).toBe(true);
  expect(response.status).toBe(500);
  expect(await response.text()).toContain("listRecords failed");
});

it.each([
  "buzz.bookhive.book",
  "buzz.bookhive.buzz",
  "social.popfeed.feed.list",
  "social.popfeed.feed.listItem",
])("reports a non-OK %s scan rather than refresh success", async (collection) => {
  const { db, close } = await createTestDb();
  try {
    const agent = {
      did: "did:plc:alice",
      get: async (_method: string, { params }: { params: { collection: string } }) =>
        params.collection === collection ? { ok: false } : { ok: true, data: { records: [] } },
    } as unknown as SessionClient;
    const app = new Hono<AppEnv>();
    app.use(timing());
    app.use(async (c, next) => {
      c.set("ctx", testContext({ db, getSessionAgent: async () => agent }));
      await next();
    });
    app.onError((error, c) => c.text(error.message, 500));
    app.route("/", profileRouter);
    for (const accept of ["application/json", "text/html"]) {
      const response = await app.request("/refresh-books", { headers: { accept } });
      expect(response.status).toBe(500);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toContain(collection);
    }
  } finally {
    await close();
  }
});
