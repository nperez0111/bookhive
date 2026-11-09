import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { createResponseAdmission } from "./response-admission";

test("a distributed burst has no admission queue and recovers after actual work settles", async () => {
  const admission = createResponseAdmission(2);
  const app = new Hono<AppEnv>();
  app.use(admission.middleware);
  const releases: Array<() => void> = [];
  app.get("/page/:id", async (c) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return c.html("ready");
  });
  app.get("/healthcheck", (c) => c.text("ok"));
  const first = app.request("/page/first");
  const second = app.request("/page/second");
  await Bun.sleep(0);
  const burst = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      Promise.resolve(
        app.request(`/page/burst-${i}`, { headers: { "X-Forwarded-For": `192.0.2.${i}` } }),
      ),
    ),
  );
  expect(burst.every((response) => response.status === 503)).toBe(true);
  expect(burst[0]!.headers.get("Cache-Control")).toBe("private, no-store");
  expect(burst[0]!.headers.get("Retry-After")).toBe("5");
  expect(admission.getStats()).toEqual({ active: 2, limit: 2, rejected: 100 });
  expect((await app.request("/healthcheck")).status).toBe(200);
  for (const release of releases.splice(0)) release();
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  expect(admission.getStats().active).toBe(0);
  const recovered = app.request("/page/recovered");
  await Bun.sleep(0);
  releases[0]!();
  expect((await recovered).status).toBe(200);
});

test("exceptions release admission and stream/write exemptions are segment-aware", async () => {
  const admission = createResponseAdmission(1);
  const app = new Hono<AppEnv>();
  app.onError((_, c) => c.text("failed", 500));
  app.use(admission.middleware);
  let release!: () => void;
  app.get("/hold", async (c) => {
    await new Promise<void>((resolve) => (release = resolve));
    return c.text("done");
  });
  app.get("/throw", () => {
    throw new Error("fixture");
  });
  app.all("*", (c) => c.text("exempt"));
  expect((await app.request("/throw")).status).toBe(500);
  expect(admission.getStats().active).toBe(0);
  const held = app.request("/hold");
  await Bun.sleep(0);
  for (const path of [
    "/metrics",
    "/import",
    "/admin/export",
    "/library/books/hash",
    "/opds/books/hash",
    "/xrpc/buzz.bookhive.getPersonalBookFile",
  ]) {
    expect((await app.request(path)).status).toBe(200);
  }
  expect((await app.request("/write", { method: "POST" })).status).toBe(200);
  expect((await app.request("/importer")).status).toBe(503);
  expect((await app.request("/page", { method: "HEAD" })).status).toBe(503);
  release();
  await held;
  expect(admission.getStats().active).toBe(0);
  for (const limit of [0, -1, 1.5, Infinity]) {
    expect(() => createResponseAdmission(limit)).toThrow(RangeError);
  }
});
