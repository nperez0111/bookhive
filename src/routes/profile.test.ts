import { expect, it } from "bun:test";
import { Hono } from "hono";
import { timing } from "hono/timing";
import type { AppContext, AppEnv } from "../context";
import profileRouter from "./profile";

it("waits for book sync before returning a shelf-sync failure", async () => {
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
  expect(await response.text()).toBe("Shelf sync failed");
});
