import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { createStorage } from "unstorage";

import { anonPageCache } from "../../src/middleware/anon-page-cache";
import { NO_STORE, PUBLIC_HTML, STATIC_ASSET_CACHE_CONTROL } from "../../src/core/cacheHeaders";
import sqliteKv, { createSharedKvDb } from "../../src/sqlite-kv";
import cacheHeadersPlugin from "./cache-headers";

type ResponseHook = (response: Response, event: { req: Request }) => void;
let hook: ResponseHook;
beforeEach(() => {
  // Invoke the actual plugin registration; only Nitro's hook host is replaced.
  const host = {
    hooks: {
      hook(name: string, callback: ResponseHook) {
        expect(name).toBe("response");
        hook = callback;
      },
    },
  };
  cacheHeadersPlugin(host as unknown as Parameters<typeof cacheHeadersPlugin>[0]);
});

describe("final Nitro cache headers", () => {
  it("never publishes Set-Cookie responses, including image-looking paths and non-GETs", () => {
    for (const path of ["/books/a", "/books/a.png", "/logo.png"])
      for (const method of ["GET", "HEAD", "POST"]) {
        const response = new Response("", {
          headers: {
            "content-type": "text/html",
            "set-cookie": "sid=new",
            "cache-control": PUBLIC_HTML,
          },
        });
        hook(response, { req: new Request(`https://test.local${path}`, { method }) });
        expect(response.headers.get("cache-control")).toBe(NO_STORE);
        expect(response.headers.get("set-cookie")).toBe("sid=new");
      }
  });

  it("keeps ordinary public HTML cacheable despite the default private app header", () => {
    for (const encoding of [undefined, "gzip"]) {
      const response = new Response("", {
        headers: {
          "content-type": "text/html",
          "cache-control": NO_STORE,
          ...(encoding ? { "content-encoding": encoding } : {}),
        },
      });
      hook(response, { req: new Request("https://test.local/books/a") });
      expect(response.headers.get("cache-control")).toBe(PUBLIC_HTML);
      expect(response.headers.get("vary")).toBe("Cookie, Accept-Encoding");
    }
  });

  it("keeps static policy and uncacheable overloads intact", () => {
    for (const status of [200, 304, 503]) {
      const response = new Response(null, { status });
      hook(response, { req: new Request("https://test.local/logo.png") });
      expect(response.headers.get("cache-control")).toBe(
        status === 503 ? NO_STORE : STATIC_ASSET_CACHE_CONTROL,
      );
    }
  });

  it("preserves wildcard Vary and does not duplicate existing fields", () => {
    for (const vary of ["*", "cookie, accept-encoding", "Origin, Cookie"]) {
      const response = new Response("", { headers: { "content-type": "text/html", vary } });
      hook(response, { req: new Request("https://test.local/books/a") });
      expect(response.headers.get("vary")).toBe(
        vary === "Origin, Cookie" ? `${vary}, Accept-Encoding` : vary,
      );
    }
  });

  it("preserves validators/privacy through the actual cache, ETag, compressor and final hook", async () => {
    const { db } = createSharedKvDb(":memory:");
    const kv = createStorage({ driver: sqliteKv({ table: "page_cache", db }) });
    let renders = 0;
    const app = new Hono();
    app.use(compress());
    app.use(etag());
    app.use(anonPageCache(kv) as any);
    app.get("/books/:id", (c) => {
      renders++;
      c.header("cache-control", PUBLIC_HTML);
      return c.html("<html>escaped &amp; canonical</html>".repeat(40));
    });
    const request = async (headers: Record<string, string> = {}) => {
      const req = new Request("https://test.local/books/a", { headers });
      const response = await app.request(req);
      hook(response, { req });
      return response;
    };
    try {
      const first = await request({ "accept-encoding": "gzip" });
      const tag = first.headers.get("etag")!;
      await first.arrayBuffer();
      const identity = await request();
      expect(identity.headers.get("etag")).toBe(tag);
      expect(identity.headers.get("cache-control")).toBe(PUBLIC_HTML);
      expect(identity.headers.get("vary")).toBe("Cookie, Accept-Encoding");
      await identity.text();
      for (const condition of [tag, tag.replace(/^W\//, ""), `"absent", ${tag}`, "*"]) {
        const response = await request({ "accept-encoding": "gzip", "if-none-match": condition });
        expect(response.status).toBe(304);
        expect(response.headers.get("etag")).toBe(tag);
        expect(response.headers.get("cache-control")).toBe(PUBLIC_HTML);
        expect(response.headers.get("vary")).toBe("Cookie, Accept-Encoding");
        for (const header of ["content-length", "content-encoding", "content-type"])
          expect(response.headers.has(header)).toBe(false);
        expect(await response.text()).toBe("");
      }
      const signedIn = await request({ cookie: "sid=personal" });
      expect(signedIn.headers.has("x-page-cache")).toBe(false);
      expect(signedIn.headers.get("cache-control")).toBe(NO_STORE);
      await signedIn.text();
      expect(renders).toBe(2);
      const private304 = await request({ cookie: "sid=personal", "if-none-match": "*" });
      expect(private304.status).toBe(304);
      expect(private304.headers.get("cache-control")).toBe(NO_STORE);
      expect(private304.headers.get("vary")).toBe("Cookie, Accept-Encoding");
      expect(await private304.text()).toBe("");
    } finally {
      await kv.dispose();
    }
  });

  it("keeps cookie-setting HTML out of both KV and the final public policy", async () => {
    const { db } = createSharedKvDb(":memory:");
    const kv = createStorage({ driver: sqliteKv({ table: "page_cache", db }) });
    const app = new Hono();
    app.use(anonPageCache(kv) as any);
    app.get("/books/a.png", (c) => {
      c.header("set-cookie", "sid=new");
      c.header("cache-control", PUBLIC_HTML);
      return c.html("<html>session</html>");
    });
    try {
      const req = new Request("https://test.local/books/a.png");
      const response = await app.request(req);
      hook(response, { req });
      expect(response.headers.get("cache-control")).toBe(NO_STORE);
      expect(response.headers.has("x-page-cache")).toBe(false);
      expect(await kv.getItem("page:/books/a.png")).toBeNull();
      expect(await response.text()).toBe("<html>session</html>");
    } finally {
      await kv.dispose();
    }
  });
});
