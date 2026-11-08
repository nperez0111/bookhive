import { expect, test } from "bun:test";
import pino from "pino";
import { createApp } from "./app";
import { createTestDb, testContext } from "./test/db";

test("public images allow cross-origin embedding without loosening other routes", async () => {
  const { db, close } = await createTestDb();
  const ctx = testContext({ db });
  try {
    const app = createApp({
      startTime: new Date().toISOString(),
      deps: { ...ctx, logger: pino({ level: "silent" }), stopEnrichmentDrain() {} },
    });
    // Exercise the real application middleware without starting an OG render worker.
    app.get("/og/__header-probe", (c) => c.body("image", 200, { "Content-Type": "image/png" }));
    const image = await app.request("/og/__header-probe");
    expect(image.status).toBe(200);
    expect(image.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(image.headers.has("Access-Control-Allow-Origin")).toBe(false);
    const page = await app.request("/healthcheck");
    expect(page.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  } finally {
    await ctx.kv.dispose();
    await close();
  }
});
