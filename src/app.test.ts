import { expect, test } from "bun:test";
import pino from "pino";
import { createApp } from "./app";
import { createTestDb, testContext } from "./test/db";

test("response stages separate route work, ETag hashing and compression setup", async () => {
  const { db, close } = await createTestDb();
  const ctx = testContext({ db });
  try {
    const app = createApp({
      startTime: new Date().toISOString(),
      deps: { ...ctx, logger: pino({ level: "silent" }), stopEnrichmentDrain() {} },
    });
    app.get("/__response-stage-probe", (c) =>
      c.html("<html>" + "fixture ".repeat(1000) + "</html>"),
    );
    const response = await app.request("/__response-stage-probe", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    const timings = response.headers.get("Server-Timing") ?? "";
    for (const stage of ["response_prepare", "response_etag", "response_compress_setup"]) {
      expect(timings).toContain(`${stage};dur=`);
    }
    const tag = response.headers.get("ETag");
    expect(tag).not.toBeNull();
    const decoded = Bun.gunzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(new TextDecoder().decode(decoded)).toBe("<html>" + "fixture ".repeat(1000) + "</html>");
    const unchanged = await app.request("/__response-stage-probe", {
      headers: { "If-None-Match": tag! },
    });
    expect(unchanged.status).toBe(304);
  } finally {
    await ctx.kv.dispose();
    await close();
  }
});

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
