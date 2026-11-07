import { afterAll, beforeAll, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { createTestDb, testContext } from "../test/db";
import importRoutes from "./import";

let database: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  database = await createTestDb();
});
afterAll(async () => {
  await database.close();
});

function setup() {
  const app = new Hono<AppEnv>();
  const ctx = testContext({ db: database.db });
  app.use(async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  app.route("/import", importRoutes);
  return app;
}

test("all native CSV providers reuse the authenticated multipart export adapter", async () => {
  const app = setup();
  for (const provider of ["goodreads", "storygraph", "hardcover"]) {
    const form = new FormData();
    form.append(
      "export",
      new File(["title,author\nBook,Author"], "library.csv", { type: "text/csv" }),
    );
    const response = await app.request(`/import/${provider}`, { method: "POST", body: form });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, code: "unauthenticated" });
  }
});

test("native CSV adapter requires the export field and preserves the 50MB maximum", async () => {
  const app = setup();
  const missing = await app.request("/import/goodreads", { method: "POST", body: new FormData() });
  expect(missing.status).toBe(400);
  const form = new FormData();
  form.append("export", new File([new Uint8Array(50 * 1024 * 1024 + 1)], "large.csv"));
  const response = await app.request("/import/goodreads", { method: "POST", body: form });
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({
    success: false,
    error: "Upload too large (max 50 MB)",
  });
});
