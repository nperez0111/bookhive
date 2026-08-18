/**
 * The anon page cache is prod-only, so nothing else exercises it. The size
 * guard in particular fails *silently* — an oversized response is served
 * normally and simply never stored, so the only symptom is that the page stays
 * slow forever.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createStorage, type Storage } from "unstorage";

import sqliteKv, { createSharedKvDb } from "../sqlite-kv";
import { anonPageCache } from "./anon-page-cache";

let kv: Storage;

beforeEach(() => {
  // The real driver, not unstorage's memory one: freshness is decided by
  // `getMeta().mtime`, and the memory driver returns no meta at all, so every
  // read would look stale and the cache would never appear to work.
  const { db } = createSharedKvDb(":memory:");
  kv = createStorage({ driver: sqliteKv({ table: "page_cache", db }) });
});

/** Hono app with the cache in front of a handler that counts its renders. */
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
    // The regression this guards: the limit used to be measured on the
    // uncompressed body, so a page like /explore/authors — 500 near-identical
    // author rows on top of the inlined CSS bundle — could be rejected at
    // ~513 KB even though it stores in ~25 KB. Every hit then re-rendered,
    // which meant re-running the aggregate behind it.
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
    // No x-page-cache header at all is the signal that a response was judged
    // uncacheable — that is the diagnostic to reach for in production.
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
    // unstorage's normalizeKey is `key.split("?")[0]...`, so a key joined with
    // a literal `?` loses its query entirely and every variant of a path
    // collapses onto one entry — `?lang=fr` was served the `?lang=en` page.
    let n = 0;
    const { app } = appServing(() => `<html>${n++}</html>`);

    expect(await (await get(app, "/p/a?lang=en&page=2")).text()).toBe("<html>0</html>");
    // Same params in a different order is the same page.
    expect(await (await get(app, "/p/a?page=2&lang=en")).text()).toBe("<html>0</html>");
    // A different value is a different page.
    expect(await (await get(app, "/p/a?lang=fr&page=2")).text()).toBe("<html>1</html>");
    // As is no params at all.
    expect(await (await get(app, "/p/a")).text()).toBe("<html>2</html>");
    // ...and each stays independently addressable afterwards.
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
