// The anon page cache is prod-only, so nothing else exercises it; the size guard fails silently, so this is the only coverage for it.
import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { inflateSync } from "node:zlib";
import { createStorage, type Storage } from "unstorage";

import sqliteKv, { createSharedKvDb } from "../sqlite-kv";
import { withTimeout } from "../lib/semaphore";
import { anonPageCache, getPageCacheMemoryStats } from "./anon-page-cache";

let kv: Storage;

beforeEach(() => {
  // The real driver, not unstorage's memory one: freshness reads `getMeta().mtime`, which the memory driver never returns.
  const { db } = createSharedKvDb(":memory:");
  kv = createStorage({ driver: sqliteKv({ table: "page_cache", db }) });
});

describe("anonPageCache negotiated representations", () => {
  const body = `<html><head><link rel="canonical" href="https://test.local/p/a"></head><body>${'<a href="/books/bk_a">A &amp; B &quot; é 📖</a>'.repeat(100)}</body></html>`;
  type Page = { bodyGzipB64: string; contentType: string; cacheControl: string; etag?: string };

  function negotiatedApp(options: { noTransform?: boolean; stream?: boolean; vary?: string } = {}) {
    let renders = 0;
    const app = new Hono();
    app.use(compress());
    app.use(etag());
    app.use(anonPageCache(kv) as any);
    app.get("/p/:name", (c) => {
      renders++;
      if (options.noTransform) c.header("cache-control", "public, max-age=3600, no-transform");
      if (options.vary) c.header("vary", options.vary);
      if (options.stream) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(body.slice(0, 200)));
              controller.enqueue(new TextEncoder().encode(body.slice(200)));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/html" } },
        );
      }
      return c.html(body);
    });
    return { app, renders: () => renders };
  }

  async function decoded(response: Response) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const encoding = response.headers.get("content-encoding");
    return Buffer.from(
      encoding === "gzip"
        ? Bun.gunzipSync(bytes)
        : encoding === "deflate"
          ? inflateSync(bytes)
          : bytes,
    ).toString();
  }

  it("shares one weak validator across cold fills, gzip hits and raw/deflate fallbacks", async () => {
    const { app, renders } = negotiatedApp({ stream: true });
    const cold = await get(app, "/p/a", { "accept-encoding": "gzip" });
    const tag = cold.headers.get("etag");
    expect(tag).toMatch(/^W\/"page-v1-[0-9a-f]{64}"$/);
    expect(await decoded(cold)).toBe(body);
    const page = await kv.getItem<Page>("page:/p/a");
    expect(page?.etag).toBe(tag!);
    for (const [accept, expected] of [
      [undefined, null],
      ["identity", null],
      ["gzip;q=0", null],
      ["br", null],
      ["gzip", "gzip"],
      ["*;q=0.5", "gzip"],
      ["gzip;q=0, *;q=0.5", "deflate"],
      ["deflate;q=1, gzip;q=0.5", "deflate"],
      ["identity;q=1, gzip;q=0.5", "gzip"],
    ] as const) {
      const response = await get(app, "/p/a", accept ? { "accept-encoding": accept } : undefined);
      expect(response.headers.get("content-encoding")).toBe(expected);
      expect(response.headers.get("etag")).toBe(tag);
      expect(response.headers.get("content-length")).toBeNull();
      expect(response.headers.get("vary")).toBe("Cookie, Accept-Encoding");
      expect(response.headers.get("x-page-cache")).toBe("hit");
      if (accept === "gzip") {
        expect(new Uint8Array(await response.clone().arrayBuffer())).toEqual(
          Buffer.from(page!.bodyGzipB64, "base64"),
        );
      }
      expect(await decoded(response)).toBe(body);
    }
    expect(renders()).toBe(1);
  });

  it("returns bodyless 304s for weak/strong/list/star conditions, without representation headers", async () => {
    const { app } = negotiatedApp();
    const first = await get(app, "/p/a");
    const tag = first.headers.get("etag")!;
    await first.text();
    for (const condition of [
      tag,
      tag.replace(/^W\//, ""),
      `"absent", ${tag}`,
      `${tag}  , "absent"`,
      "*",
    ]) {
      const response = await get(app, "/p/a", {
        "accept-encoding": "gzip",
        "if-none-match": condition,
      });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe(tag);
      expect(response.headers.get("cache-control")).toContain("public");
      expect(response.headers.get("vary")).toBe("Cookie, Accept-Encoding");
      for (const header of ["content-type", "content-encoding", "content-length", "x-page-cache"])
        expect(response.headers.has(header)).toBe(false);
    }
    const miss = await get(app, "/p/a", { "if-none-match": '"absent"' });
    expect(miss.status).toBe(200);
    expect(await miss.text()).toBe(body);
  });

  it("reads legacy entries without trusting a validator for already-encoded bytes", async () => {
    const { app, renders } = negotiatedApp();
    await kv.setItem("page:/p/a", {
      bodyGzipB64: Buffer.from(Bun.gzipSync(body)).toString("base64"),
      contentType: "text/html",
      cacheControl: "public, max-age=3600",
    });
    const response = await get(app, "/p/a", { "accept-encoding": "gzip" });
    expect(response.headers.get("x-page-cache")).toBe("hit");
    expect(response.headers.get("etag")).not.toContain("page-v1");
    expect(await decoded(response)).toBe(body);
    expect(renders()).toBe(0);
  });

  it("fails open for malformed/mismatched metadata and detectable gzip corruption", async () => {
    const { app, renders } = negotiatedApp();
    await (await get(app, "/p/a")).text();
    const valid = (await kv.getItem<Page>("page:/p/a"))!;
    const changed = Buffer.from(valid.bodyGzipB64, "base64");
    changed[20] = changed[20]! ^ 1;
    for (const page of [
      { ...valid, etag: '"untrusted"' },
      { ...valid, bodyGzipB64: changed.toString("base64") },
      { ...valid, etag: undefined, bodyGzipB64: "not gzip" },
    ]) {
      await kv.setItem("page:/p/a", page);
      const response = await get(app, "/p/a", { "accept-encoding": "gzip" });
      expect(response.headers.get("x-page-cache")).toBe("miss");
      expect(await decoded(response)).toBe(body);
    }
    expect(renders()).toBe(4);
  });

  it("respects no-transform even when gzip is available in storage", async () => {
    const { app } = negotiatedApp({ noTransform: true });
    for (let n = 0; n < 2; n++) {
      const response = await get(app, "/p/a", { "accept-encoding": "gzip" });
      expect(response.headers.has("content-encoding")).toBe(false);
      expect(await response.text()).toBe(body);
    }
  });

  it("does not inflate gzip hits or conditional hits, and avoids a second cold-fill clone", async () => {
    const { app } = negotiatedApp();
    const clone = spyOn(Response.prototype, "clone");
    let tag: string;
    try {
      const cold = await get(app, "/p/a");
      tag = cold.headers.get("etag")!;
      expect(clone).toHaveBeenCalledTimes(1);
      await cold.text();
    } finally {
      clone.mockRestore();
    }
    const inflate = spyOn(Bun, "gunzipSync").mockImplementation(() => {
      throw new Error("must not expand");
    });
    try {
      const gzip = await get(app, "/p/a", { "accept-encoding": "gzip" });
      expect(gzip.headers.get("x-page-cache")).toBe("hit");
      expect(gzip.headers.get("content-encoding")).toBe("gzip");
      await gzip.arrayBuffer();
      const conditional = await get(app, "/p/a", { "if-none-match": tag! });
      expect(conditional.status).toBe(304);
      expect(await conditional.text()).toBe("");
      expect(inflate).not.toHaveBeenCalled();
    } finally {
      inflate.mockRestore();
    }
  });

  it("has the same weak validator regardless of source chunk boundaries", async () => {
    const first = await get(negotiatedApp().app, "/p/a");
    const tag = first.headers.get("etag");
    await first.text();
    await kv.removeItem("page:/p/a");
    const second = await get(negotiatedApp({ stream: true }).app, "/p/a");
    expect(second.headers.get("etag")).toBe(tag);
    expect(await second.text()).toBe(body);
  });

  it("continues to bypass the anonymous cache for HEAD", async () => {
    const { app, renders } = negotiatedApp();
    await (await get(app, "/p/a")).text();
    const response = await app.request("http://test.local/p/a", {
      method: "HEAD",
      headers: { "accept-encoding": "gzip" },
    });
    expect(response.headers.has("x-page-cache")).toBe(false);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(await response.text()).toBe("");
    expect(renders()).toBe(2);
  });

  it("preserves existing and wildcard Vary on the cold rendered response", async () => {
    for (const vary of ["Origin, Cookie", "*"]) {
      const { app } = negotiatedApp({ vary });
      const response = await get(app, `/p/vary-${encodeURIComponent(vary)}`);
      expect(response.headers.get("vary")).toBe(vary === "*" ? "*" : `${vary}, Accept-Encoding`);
      expect(await response.text()).toBe(body);
    }
  });

  it("does not cache 503s or already-encoded HTML", async () => {
    for (const [status, encoding] of [
      [503, undefined],
      [200, "gzip"],
    ] as const) {
      const app = new Hono();
      app.use(anonPageCache(kv) as any);
      app.get(
        "/p/:name",
        () =>
          new Response(encoding ? Bun.gzipSync(body) : body, {
            status,
            headers: {
              "content-type": "text/html",
              ...(encoding ? { "content-encoding": encoding } : {}),
            },
          }),
      );
      const response = await get(app, `/p/status-${status}`);
      expect(response.headers.has("x-page-cache")).toBe(false);
      expect(await kv.getItem(`page:/p/status-${status}`)).toBeNull();
      await response.arrayBuffer();
    }
  });
});

// Hono app with the cache in front of a handler that counts its renders.
function appServing(body: string | (() => string)) {
  let renders = 0;
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use("/p/*", anonPageCache(kv) as any);
  app.get("/p/:name", (c) => {
    renders++;
    return c.html(typeof body === "function" ? body() : body);
  });
  return { app, renders: () => renders };
}

const get = (app: Hono, path: string, headers?: Record<string, string>) =>
  app.request(new Request(`http://test.local${path}`, { headers }));

describe("anonPageCache storage", () => {
  it("skips optional extraction without queuing when two other bodies are still open", async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const app = new Hono();
    app.use("/p/*", anonPageCache(kv) as any);
    app.get(
      "/p/:name",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controllers.push(controller);
              controller.enqueue(new TextEncoder().encode("<html>stream</html>"));
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
    );
    const before = getPageCacheMemoryStats().page_cache_skipped_fills;
    const first = get(app, "/p/first");
    const second = get(app, "/p/second");
    let third: Response | undefined;
    try {
      await withTimeout(
        (async () => {
          while (
            getPageCacheMemoryStats().page_cache_active_fills < 2 ||
            getPageCacheMemoryStats().page_cache_buffered_bytes === 0
          )
            await Bun.sleep(0);
        })(),
        1000,
        "cache fills started",
      );
      third = await withTimeout(Promise.resolve(get(app, "/p/third")), 1000, "uncached response");
      expect(third.status).toBe(200);
      expect(third.headers.get("x-page-cache")).toBeNull();
      expect(getPageCacheMemoryStats().page_cache_active_fills).toBe(2);
      expect(getPageCacheMemoryStats().page_cache_skipped_fills).toBe(before + 1);
    } finally {
      for (const controller of controllers) controller.close();
      for (const response of await Promise.all([first, second])) await response.text();
      if (third) expect(await third.text()).toBe("<html>stream</html>");
    }
    expect(getPageCacheMemoryStats().page_cache_active_fills).toBe(0);
    expect(getPageCacheMemoryStats().page_cache_buffered_bytes).toBe(0);
    expect(
      (await get(appServing("recovered").app, "/p/recovered")).headers.get("x-page-cache"),
    ).toBe("miss");
  });

  it("serves the rendered page when persistence fails, and can recover on the next request", async () => {
    const write = spyOn(kv, "setItem").mockRejectedValue(new Error("database is locked"));
    const { app, renders } = appServing("<html>still available</html>");
    const res = await get(app, "/p/locked");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>still available</html>");
    expect(res.headers.get("x-page-cache")).toBeNull();
    write.mockRestore();
    expect((await get(app, "/p/locked")).headers.get("x-page-cache")).toBe("miss");
    expect((await get(app, "/p/locked")).headers.get("x-page-cache")).toBe("hit");
    expect(renders()).toBe(2);
  });

  it("treats a failed cache read as a miss", async () => {
    const read = spyOn(kv, "getMeta").mockImplementation(() => {
      throw new Error("cache unavailable");
    });
    const { app } = appServing("<html>fresh</html>");
    const res = await get(app, "/p/read-failure");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>fresh</html>");
    read.mockRestore();
  });

  it("releases extraction accounting when the source stream fails", async () => {
    const app = new Hono();
    app.use("/p/*", anonPageCache(kv) as any);
    app.get(
      "/p/broken-stream",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
              controller.error(new Error("source failed"));
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
    );
    const response = await get(app, "/p/broken-stream");
    expect(response.status).toBe(200);
    expect(response.text()).rejects.toThrow("source failed");
    expect(getPageCacheMemoryStats().page_cache_active_fills).toBe(0);
    expect(getPageCacheMemoryStats().page_cache_buffered_bytes).toBe(0);
  });

  it("does not fail coalesced waiters when a rendered page cannot be persisted", async () => {
    const write = spyOn(kv, "setItem").mockRejectedValue(new Error("database is locked"));
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let renders = 0;
    const app = new Hono();
    app.use("/p/*", anonPageCache(kv) as any);
    app.get("/p/waiters", async (c) => {
      renders++;
      started.resolve();
      await release.promise;
      return c.html("<html>shared render</html>");
    });
    const first = get(app, "/p/waiters");
    await started.promise;
    const second = get(app, "/p/waiters");
    // Let the second request finish its asynchronous metadata lookup and join the render.
    await Bun.sleep(0);
    release.resolve();
    let sharedTag: string | null = null;
    for (const res of await Promise.all([first, second])) {
      expect(res.status).toBe(200);
      expect(res.headers.get("etag")).toMatch(/^W\/"page-v1-[0-9a-f]{64}"$/);
      sharedTag ??= res.headers.get("etag");
      expect(res.headers.get("etag")).toBe(sharedTag);
      expect(await res.text()).toBe("<html>shared render</html>");
    }
    expect(renders).toBe(1);
    write.mockRestore();
  });

  it("stops caching an oversized stream without waiting for cancellation of the live tee", async () => {
    const app = new Hono();
    app.use("/p/*", anonPageCache(kv) as any);
    const chunk = "x".repeat(1024 * 1024);
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    app.get(
      "/p/large-stream",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              streamController = controller;
              for (let n = 0; n < 6; n++) controller.enqueue(new TextEncoder().encode(chunk));
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
    );
    let res: Response;
    try {
      // Headers must be returned while the original stream remains open. Whole-body
      // buffering or awaiting clone cancellation would both wait for close here.
      res = await withTimeout(
        Promise.resolve(get(app, "/p/large-stream")),
        1000,
        "oversized live stream",
      );
    } finally {
      streamController.close();
    }
    expect(res.status).toBe(200);
    expect(res.headers.get("x-page-cache")).toBeNull();
    expect((await res.text()).length).toBe(6 * chunk.length);
  });

  it("stores and replays an anonymous page", async () => {
    const { app, renders } = appServing("<html>hello</html>");

    const first = await get(app, "/p/a");
    expect(first.headers.get("x-page-cache")).toBe("miss");

    const second = await get(app, "/p/a");
    expect(second.headers.get("x-page-cache")).toBe("hit");
    expect(await second.text()).toBe("<html>hello</html>");
    expect(renders()).toBe(1);
  });

  it("caches a large but compressible page", async () => {
    // Guards against measuring the limit on the uncompressed body, which rejected pages that would have stored small.
    const row = `<a href="/authors/Someone" class="group flex min-h-10 items-center gap-3 border-b border-border px-4 py-3"><span class="flex-1 truncate text-sm font-medium">Someone</span></a>`;
    const big = `<html>${row.repeat(3000)}</html>`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(512 * 1024);

    const { app, renders } = appServing(big);
    expect((await get(app, "/p/big")).headers.get("x-page-cache")).toBe("miss");
    expect((await get(app, "/p/big")).headers.get("x-page-cache")).toBe("hit");
    expect(renders()).toBe(1);
  });

  it("refuses a page that is still too large once compressed", async () => {
    // Random data doesn't compress, so this exceeds the stored-bytes ceiling.
    const incompressible = `<html>${Buffer.from(
      crypto.getRandomValues(new Uint8Array(400 * 1024)),
    ).toString("base64")}</html>`;

    const { app, renders } = appServing(incompressible);
    // No x-page-cache header at all is the production diagnostic for "judged uncacheable".
    expect((await get(app, "/p/rand")).headers.get("x-page-cache")).toBeNull();
    await get(app, "/p/rand");
    expect(renders()).toBe(2);
  });

  it("bypasses signed-in requests and downgrades their Cache-Control", async () => {
    const { app, renders } = appServing("<html>personal</html>");

    const res = await get(app, "/p/a", { cookie: "sid=abc" });
    expect(res.headers.get("x-page-cache")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    await get(app, "/p/a", { cookie: "sid=abc" });
    expect(renders()).toBe(2);
  });

  it("passes through requests carrying a param outside the allowlist", async () => {
    const { app, renders } = appServing("<html>x</html>");

    expect((await get(app, "/p/a?utm_source=x")).headers.get("x-page-cache")).toBeNull();
    await get(app, "/p/a?utm_source=x");
    expect(renders()).toBe(2);
  });

  it("keys allowlisted params separately, order-independently", async () => {
    // Guards against a `?`-joined key, which unstorage's normalizeKey truncates, collapsing every query variant onto one entry.
    let n = 0;
    const { app } = appServing(() => `<html>${n++}</html>`);

    expect(await (await get(app, "/p/a?lang=en&page=2")).text()).toBe("<html>0</html>");
    expect(await (await get(app, "/p/a?page=2&lang=en")).text()).toBe("<html>0</html>");
    expect(await (await get(app, "/p/a?lang=fr&page=2")).text()).toBe("<html>1</html>");
    expect(await (await get(app, "/p/a")).text()).toBe("<html>2</html>");
    expect(await (await get(app, "/p/a?lang=en&page=2")).text()).toBe("<html>0</html>");
    expect(await (await get(app, "/p/a?lang=fr&page=2")).text()).toBe("<html>1</html>");
  });

  it("keeps paths distinct when a param value contains a separator", async () => {
    let n = 0;
    const { app } = appServing(() => `<html>${n++}</html>`);

    expect(await (await get(app, "/p/a?lang=x/y")).text()).toBe("<html>0</html>");
    expect(await (await get(app, "/p/a?lang=x%3Fy")).text()).toBe("<html>1</html>");
    expect(await (await get(app, "/p/a?lang=x/y")).text()).toBe("<html>0</html>");
  });

  it("does not store a response carrying a Set-Cookie", async () => {
    const app = new Hono();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use("/p/*", anonPageCache(kv) as any);
    app.get("/p/:name", (c) => {
      c.header("set-cookie", "sid=new");
      return c.html("<html>x</html>");
    });

    expect((await get(app, "/p/a")).headers.get("x-page-cache")).toBeNull();
  });
});
