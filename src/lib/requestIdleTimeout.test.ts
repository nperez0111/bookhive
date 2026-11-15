import { expect, test } from "bun:test";
import { Hono } from "hono";
import { serve } from "srvx/bun";

import { disableRequestIdleTimeout } from "./requestIdleTimeout";

test("ordinary Requests have no runtime timeout override", () => {
  expect(disableRequestIdleTimeout(new Request("http://localhost/"))).toBe(false);
});

test("only the original Bun request receives the zero idle timeout", () => {
  const request = new Request("http://localhost/");
  const calls: unknown[][] = [];
  Object.defineProperty(request, "runtime", {
    value: { name: "bun", bun: { server: { timeout: (...args: unknown[]) => calls.push(args) } } },
  });
  expect(disableRequestIdleTimeout(request)).toBe(true);
  expect(calls).toEqual([[request, 0]]);
  expect(request.signal.aborted).toBe(false);
});

test("scoped exemption survives srvx/Hono without disabling disconnect cancellation", async () => {
  const app = new Hono();
  const aborted = Promise.withResolvers<void>();
  app.get("/ordinary", async (c) => {
    await Bun.sleep(4000);
    return c.text("ordinary");
  });
  app.get("/slow", async (c) => {
    disableRequestIdleTimeout(c.req.raw);
    await Bun.sleep(4000);
    return c.text("ready");
  });
  app.get("/abort", async (c) => {
    disableRequestIdleTimeout(c.req.raw);
    c.req.raw.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    await aborted.promise;
    return c.text("cancelled");
  });
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    silent: true,
    bun: { idleTimeout: 1 },
    fetch: (request) => app.fetch(request),
  });
  try {
    await server.ready();
    const ordinary = fetch(new URL("/ordinary", server.url), { keepalive: false }).then(
      () => false,
      () => true,
    );
    const [response, ordinaryTimedOut] = await Promise.all([
      fetch(new URL("/slow", server.url), { keepalive: false }),
      ordinary,
    ]);
    expect(await response.text()).toBe("ready");
    expect(ordinaryTimedOut).toBe(true);
    const controller = new AbortController();
    const pending = fetch(new URL("/abort", server.url), {
      signal: controller.signal,
      keepalive: false,
    });
    setTimeout(() => controller.abort(), 100);
    expect(
      await pending.then(
        () => false,
        () => true,
      ),
    ).toBe(true);
    await Promise.race([
      aborted.promise,
      Bun.sleep(2000).then(() => {
        throw new Error("disconnect was not propagated");
      }),
    ]);
  } finally {
    await server.close(true);
  }
}, 10000);
