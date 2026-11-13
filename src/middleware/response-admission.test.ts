import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { createResponseAdmission } from "./response-admission";

test("expensive bursts leave cheap-read capacity and cookie requests have reserved headroom", async () => {
  const admission = createResponseAdmission(32);
  const app = new Hono<AppEnv>();
  app.use(admission.middleware);
  const releases: Array<() => void> = [];
  const pending: Array<Promise<Response>> = [];
  app.all("*", async (c) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return c.text("ready");
  });
  const hold = async (path: string, cookie?: string, method = "GET") => {
    pending.push(
      Promise.resolve(
        app.request(path, {
          method,
          headers: cookie === undefined ? {} : { Cookie: cookie },
        }),
      ),
    );
    await Bun.sleep(0);
  };
  try {
    for (let i = 0; i < 12; i++) await hold(`/profile/fixture-${i}`);
    expect((await app.request("/og/book/overflow")).status).toBe(503);
    for (let i = 0; i < 4; i++) await hold("/xrpc/buzz.bookhive.getProfile", "unverified=1");
    expect((await app.request("/search", { headers: { Cookie: "unverified=1" } })).status).toBe(
      503,
    );
    // Segment-aware route classification: this is not /profile.
    for (let i = 0; i < 12; i++) await hold("/profile-not-expensive");
    expect(
      (await app.request("/books/anonymous-overflow", { headers: { Cookie: "" } })).status,
    ).toBe(503);
    for (let i = 0; i < 4; i++) await hold("/books/fixture", "anything=1", "HEAD");
    expect(
      (await app.request("/books/total-overflow", { headers: { Cookie: "anything=1" } })).status,
    ).toBe(503);
    expect(admission.getStats()).toMatchObject({
      active: 32,
      anonymousActive: 24,
      expensiveActive: 16,
      expensiveAnonymousActive: 12,
      rejectedByReason: { total: 1, anonymous: 1, expensive: 1, expensive_anonymous: 1 },
    });
  } finally {
    for (const release of releases) release();
    expect((await Promise.all(pending)).every((response) => response.status === 200)).toBe(true);
  }
  expect(admission.getStats()).toMatchObject({
    active: 0,
    anonymousActive: 0,
    expensiveActive: 0,
    expensiveAnonymousActive: 0,
  });
});

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
  const second = app.request("/page/second", { headers: { Cookie: "fixture=1" } });
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
  expect(admission.getStats()).toMatchObject({ active: 2, limit: 2, rejected: 100 });
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
  app.get("/profile/throw", () => {
    throw new Error("fixture");
  });
  app.all("*", (c) => c.text("exempt"));
  expect((await app.request("/profile/throw")).status).toBe(500);
  expect(admission.getStats()).toMatchObject({
    active: 0,
    anonymousActive: 0,
    expensiveActive: 0,
    expensiveAnonymousActive: 0,
  });
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
