import { expect, test } from "bun:test";
import pino from "pino";
import { env } from "./env";
import { createApp } from "./app";
import { createTestDb, testContext } from "./test/db";
import { NO_STORE, PUBLIC_HTML } from "./core/cacheHeaders";
import cacheHeadersPlugin from "../server/plugins/cache-headers";

test("application admission remains occupied while ETag consumes a response body", async () => {
  const { db, close } = await createTestDb();
  const ctx = testContext({ db });
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  try {
    const app = createApp({
      startTime: new Date().toISOString(),
      deps: { ...ctx, logger: pino({ level: "silent" }), stopEnrichmentDrain() {} },
    });
    let started = 0;
    let ready!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    app.get("/__admission-probe/:id", (c) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller);
          controller.enqueue(new TextEncoder().encode("fixture"));
        },
      });
      if (++started === env.RESPONSE_PREPARATION_CONCURRENCY) ready();
      return c.body(body, 200, { "Content-Type": "text/html" });
    });
    const pending = Array.from({ length: env.RESPONSE_PREPARATION_CONCURRENCY }, (_, i) =>
      Promise.resolve(app.request(`/__admission-probe/${i}`, { headers: { Cookie: "fixture=1" } })),
    );
    await allStarted;
    expect((await app.request("/__admission-probe/overflow")).status).toBe(503);
    expect((await app.request("/healthcheck")).status).toBe(200);
    for (const controller of controllers.splice(0)) controller.close();
    for (const response of await Promise.all(pending)) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("fixture");
    }
    expect((await app.request("/healthcheck")).status).toBe(200);
  } finally {
    for (const controller of controllers) controller.close();
    await ctx.kv.dispose();
    await close();
  }
});

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

test("cookie-setting responses bypass conditional ETags and retain final no-store privacy", async () => {
  const { db, close } = await createTestDb();
  const ctx = testContext({ db });
  try {
    const app = createApp({
      startTime: new Date().toISOString(),
      deps: { ...ctx, logger: pino({ level: "silent" }), stopEnrichmentDrain() {} },
    });
    app.get("/__cookie-etag-probe.png", (c) => {
      c.header("Set-Cookie", "sid=new; HttpOnly; Path=/");
      c.header("Cache-Control", PUBLIC_HTML);
      return c.html("<html>session established</html>");
    });
    const req = new Request("https://test.local/__cookie-etag-probe.png", {
      headers: { "If-None-Match": "*" },
    });
    const response = await app.request(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBe("sid=new; HttpOnly; Path=/");
    expect(response.headers.has("ETag")).toBe(false);
    const timings = response.headers.get("Server-Timing") ?? "";
    expect(timings).toContain("response_prepare;dur=");
    expect(timings).not.toContain("response_etag;dur=");

    // Run the actual final hook, replacing only Nitro's hook-registration host.
    type ResponseHook = (response: Response, event: { req: Request }) => void;
    let responseHook: ResponseHook | undefined;
    const host = {
      hooks: {
        hook(name: string, callback: ResponseHook) {
          expect(name).toBe("response");
          responseHook = callback;
        },
      },
    };
    cacheHeadersPlugin(host as unknown as Parameters<typeof cacheHeadersPlugin>[0]);
    expect(responseHook).toBeDefined();
    responseHook!(response, { req });
    expect(response.headers.get("Cache-Control")).toBe(NO_STORE);
    expect(response.headers.get("Set-Cookie")).toBe("sid=new; HttpOnly; Path=/");
    expect(await response.text()).toBe("<html>session established</html>");
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
