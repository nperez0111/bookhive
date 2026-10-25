import { afterEach, describe, expect, it, mock } from "bun:test";
import { createStorage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";
import type { SessionClient } from "../auth/client";
import type { ProfileViewDetailed } from "../types";
import { withTimeout } from "../lib/semaphore";
import { createProfileCache, getProfile, getProfiles } from "./getProfile";

const DAY = 86_400_000;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function profile(did: string, displayName = did): ProfileViewDetailed {
  return { did, handle: `${did.split(":").at(-1)}.test`, displayName } as ProfileViewDetailed;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function context(get: SessionClient["get"], kv = profileStorage(), did = "did:plc:viewer") {
  const agent: SessionClient = { did, get, post: get };
  return { kv, getSessionDid: async () => did, getSessionAgent: mock(async () => agent) };
}

function profileStorage() {
  const kv = createStorage();
  kv.mount("profile:", createProfileCache());
  return kv;
}

function key(did: string, viewer = "did:plc:viewer") {
  return `profile:${viewer}:${did}`;
}

async function seed(ctx: ReturnType<typeof context>, value: ProfileViewDetailed, age = 0) {
  await ctx.kv.set(key(value.did), { profile: value, fetchedAt: Date.now() - age });
}

async function eventually(check: () => Promise<boolean>) {
  await withTimeout(
    (async () => {
      while (!(await check())) await Bun.sleep(1);
    })(),
    500,
    "background profile write",
  );
}

describe("profile cache", () => {
  it("returns fresh cached profiles without a network request", async () => {
    const get = mock(async () => {
      throw new Error("must not fetch");
    });
    const ctx = context(get);
    const cached = profile("did:plc:alice");
    await seed(ctx, cached);
    expect(await getProfile({ ctx, did: cached.did })).toEqual(cached);
    expect(get).not.toHaveBeenCalled();
    expect(ctx.getSessionAgent).not.toHaveBeenCalled();
  });

  it("serves stale without waiting for OAuth or a shared single/batch refresh", async () => {
    const refresh = deferred<{ ok: true; data: { profiles: ProfileViewDetailed[] } }>();
    const get = mock(() => refresh.promise);
    const ctx = context(get);
    const restore = deferred<SessionClient>();
    const agent = await ctx.getSessionAgent();
    ctx.getSessionAgent = mock(() => restore.promise);
    const cached = profile("did:plc:alice", "old");
    const updated = profile(cached.did, "new");
    await seed(ctx, cached, 2 * DAY);
    expect(await withTimeout(getProfiles({ ctx, dids: [cached.did] }), 100, "stale read")).toEqual([
      cached,
    ]);
    expect(
      await withTimeout(getProfile({ ctx, did: cached.did }), 100, "second stale read"),
    ).toEqual(cached);
    expect(get).not.toHaveBeenCalled();
    expect(ctx.getSessionAgent).toHaveBeenCalledTimes(1);
    restore.resolve(agent);
    await eventually(async () => get.mock.calls.length === 1);
    refresh.resolve({ ok: true, data: { profiles: [updated] } });
    await eventually(
      async () =>
        (await ctx.kv.get<{ profile: ProfileViewDetailed }>(key(cached.did)))?.profile
          .displayName === "new",
    );
    expect(await getProfile({ ctx, did: cached.did })).toEqual(updated);
  });

  it("deduplicates overlapping cold single/batch reads and preserves requested order", async () => {
    const refresh = deferred<{ ok: true; data: { profiles: ProfileViewDetailed[] } }>();
    const get = mock(() => refresh.promise);
    const ctx = context(get);
    const alice = profile("did:plc:alice");
    const bob = profile("did:plc:bob");
    const first = getProfiles({ ctx, dids: [bob.did, alice.did, bob.did] });
    await eventually(async () => get.mock.calls.length === 1);
    const second = getProfile({ ctx, did: alice.did });
    await Bun.sleep(1);
    refresh.resolve({ ok: true, data: { profiles: [alice, bob] } });
    expect(await first).toEqual([bob, alice]);
    expect(await second).toEqual(alice);
    expect(get).toHaveBeenCalledTimes(1);
    expect(await getProfile({ ctx, did: alice.did })).toEqual(alice);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("waits only for misses, not an unrelated in-flight stale refresh", async () => {
    const staleGate = deferred<{ ok: true; data: { profiles: ProfileViewDetailed[] } }>();
    const old = profile("did:plc:old");
    const cold = profile("did:plc:cold");
    const get = mock(async (_name: string, opts?: Record<string, unknown>) => {
      const actors = (opts!["params"] as { actors: string[] }).actors;
      return actors.includes(old.did)
        ? staleGate.promise
        : { ok: true as const, data: { profiles: [cold] } };
    });
    const ctx = context(get);
    await seed(ctx, old, 2 * DAY);
    expect(await getProfile({ ctx, did: old.did })).toEqual(old);
    expect(
      await withTimeout(getProfiles({ ctx, dids: [old.did, cold.did] }), 100, "mixed cache read"),
    ).toEqual([old, cold]);
    staleGate.resolve({ ok: true, data: { profiles: [old] } });
    await Bun.sleep(1);
  });

  it("retains successful batch results when a different batch fails", async () => {
    const dids = Array.from({ length: 26 }, (_, i) => `did:plc:batch${i}`);
    const get = mock(async (_name: string, opts?: Record<string, unknown>) => {
      const actors = (opts!["params"] as { actors: string[] }).actors;
      if (actors.includes(dids[25]!)) throw new Error("one batch is unavailable");
      return { ok: true as const, data: { profiles: actors.map((did) => profile(did)) } };
    });
    const ctx = context(get);
    expect(await getProfiles({ ctx, dids })).toEqual(dids.slice(0, 25).map((did) => profile(did)));
    expect(await getProfile({ ctx, did: dids[0]! })).toEqual(profile(dids[0]!));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps stale values and their original age after a refresh failure", async () => {
    const get = mock(async () => ({ ok: false as const, data: { error: "Unavailable" } }));
    const ctx = context(get);
    const cached = profile("did:plc:alice");
    const timestamp = Date.now() - 2 * DAY;
    await ctx.kv.set(key(cached.did), { profile: cached, fetchedAt: timestamp });
    expect(await getProfile({ ctx, did: cached.did })).toEqual(cached);
    await Bun.sleep(1);
    expect(await ctx.kv.get(key(cached.did))).toEqual({ profile: cached, fetchedAt: timestamp });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded LRU with TTL, and returns null on an expired miss/failure", async () => {
    expect(createProfileCache().options).toMatchObject({ max: 10_000, ttl: 30 * DAY });
    const ctx = context(async () => {
      throw new Error("offline");
    }, createStorage());
    ctx.kv.mount("profile:", lruCacheDriver({ max: 1, ttl: 10, ttlResolution: 0 }));
    const alice = profile("did:plc:alice");
    const bob = profile("did:plc:bob");
    await seed(ctx, alice);
    await seed(ctx, bob);
    expect(await getProfile({ ctx, did: alice.did })).toBeNull();
    expect(await getProfile({ ctx, did: bob.did })).toEqual(bob);
    await Bun.sleep(20);
    expect(await getProfile({ ctx, did: bob.did })).toBeNull();
  });

  it("bounds batch size and concurrent requests, even across separate reads", async () => {
    const gates: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const get = mock(async (_name: string, opts?: Record<string, unknown>) => {
      const actors = (opts!["params"] as { actors: string[] }).actors;
      expect(actors.length).toBeLessThanOrEqual(25);
      expect(opts?.["signal"]).toBeInstanceOf(AbortSignal);
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active--;
      return { ok: true as const, data: { profiles: actors.map((did) => profile(did)) } };
    });
    const ctx = context(get);
    const first = getProfiles({ ctx, dids: Array.from({ length: 75 }, (_, i) => `did:plc:a${i}`) });
    const second = getProfiles({
      ctx,
      dids: Array.from({ length: 25 }, (_, i) => `did:plc:b${i}`),
    });
    await eventually(async () => gates.length === 3);
    expect(get).toHaveBeenCalledTimes(3);
    gates.shift()!();
    await eventually(async () => get.mock.calls.length === 4);
    for (const release of gates) release();
    expect((await first).length).toBe(75);
    expect((await second).length).toBe(25);
    expect(peak).toBe(3);
  });

  it("isolates public and per-viewer values and in-flight requests", async () => {
    const kv = profileStorage();
    const did = "did:plc:alice";
    const publicProfile = profile(did, "public");
    const gate = deferred<Response>();
    const fetch = mock((_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("atproto-proxy")).toBe(false);
      return gate.promise;
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const viewerGet = mock(async (_name: string, opts?: Record<string, unknown>) => {
      expect(opts?.["headers"]).toEqual({ "atproto-proxy": "did:web:api.bsky.app#bsky_appview" });
      return {
        ok: true as const,
        data: { profiles: [{ ...profile(did, "viewer-a"), viewer: { muted: true } }] },
      };
    });
    const ctx = context(viewerGet, kv, "did:plc:viewer-a");
    const publicRead = getProfile({ ctx, did, publicOnly: true });
    await eventually(async () => fetch.mock.calls.length === 1);
    expect(ctx.getSessionAgent).not.toHaveBeenCalled();
    expect((await getProfile({ ctx, did }))?.displayName).toBe("viewer-a");
    const otherCtx = context(
      async () => ({ ok: true, data: { profiles: [profile(did, "viewer-b")] } }),
      kv,
      "did:plc:viewer-b",
    );
    expect((await getProfile({ ctx: otherCtx, did }))?.displayName).toBe("viewer-b");
    gate.resolve(Response.json({ profiles: [publicProfile] }));
    expect(await publicRead).toEqual(publicProfile);
    expect(await getProfile({ ctx, did, publicOnly: true })).toEqual(publicProfile);
    expect((await getProfile({ ctx, did }))?.displayName).toBe("viewer-a");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(viewerGet).toHaveBeenCalledTimes(1);
  });

  it("bounds caller wait but holds concurrency slots until an abort-ignoring transport settles", async () => {
    const gate = deferred<void>();
    const signals: AbortSignal[] = [];
    const get = mock(async (_name: string, opts?: Record<string, unknown>) => {
      signals.push(opts!["signal"] as AbortSignal);
      const actors = (opts!["params"] as { actors: string[] }).actors;
      if (get.mock.calls.length <= 3) await gate.promise;
      return { ok: true as const, data: { profiles: actors.map((did) => profile(did)) } };
    });
    const ctx = context(get);
    const cold = ["a", "b", "c"].map((id) => getProfile({ ctx, did: `did:plc:${id}` }));
    expect(await withTimeout(Promise.all(cold), 3_500, "profile caller deadline")).toEqual([
      null,
      null,
      null,
    ]);
    expect(signals.length).toBe(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    // These requests did not release their slots when the caller timed out.
    expect(
      await withTimeout(
        getProfile({ ctx, did: "did:plc:queued" }),
        1_000,
        "profile queue deadline",
      ),
    ).toBeNull();
    expect(get).toHaveBeenCalledTimes(3);
    gate.resolve();
    await Bun.sleep(1);
    expect(await getProfile({ ctx, did: "did:plc:recovered" })).toEqual(
      profile("did:plc:recovered"),
    );
    expect(get).toHaveBeenCalledTimes(4);
    // Late abandoned responses cannot install data after the failed refresh.
    expect(await ctx.kv.get(key("did:plc:a"))).toBeNull();
  }, 10_000);

  it("falls back to the public cache after a failed restore, never writing it under a viewer", async () => {
    const cached = profile("did:plc:alice", "public");
    globalThis.fetch = mock(async () =>
      Response.json({ profiles: [cached] }),
    ) as unknown as typeof fetch;
    const ctx = {
      kv: profileStorage(),
      getSessionDid: async () => "did:plc:viewer",
      getSessionAgent: async () => null,
    };
    expect(await getProfile({ ctx, did: cached.did })).toEqual(cached);
    expect(await ctx.kv.get(key(cached.did))).toBeNull();
    expect(await ctx.kv.get(`profile:pub:${cached.did}`)).toMatchObject({ profile: cached });
    expect(await getProfile({ ctx, did: cached.did })).toEqual(cached);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
