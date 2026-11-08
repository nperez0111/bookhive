import { describe, expect, it } from "bun:test";
import { SessionCache } from "./sessionCache";

describe("SessionCache", () => {
  it("prunes dormant expired clients without looking up their DID", () => {
    let now = 1_000;
    const cache = new SessionCache<object>(2, () => now);
    cache.set("idle", {}, undefined);
    now += 600_000;
    cache.prune();
    expect(cache.stats()).toEqual({ entries: 0, capacity: 2, expired: 1, evicted: 0 });
  });

  it("evicts the least recently used client without touching durable sessions", () => {
    const cache = new SessionCache<object>(2);
    const a = { durableGrant: "retained" };
    cache.set("a", a, undefined);
    cache.set("b", {}, undefined);
    expect(cache.get("a")?.client).toBe(a);
    cache.set("c", {}, undefined);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")?.client).toBe(a);
    expect(a.durableGrant).toBe("retained");
    expect(cache.stats().evicted).toBe(1);
  });

  it("retains the token-expiry buffer, minimum TTL and maximum TTL", () => {
    let now = 1_000;
    const cache = new SessionCache<string>(3, () => now);
    cache.set("short", "short", now + 1_000);
    cache.set("buffered", "buffered", now + 120_000);
    cache.set("long", "long", now + 86_400_000);
    now += 9_999;
    expect(cache.get("short")?.client).toBe("short");
    now++;
    expect(cache.get("short")).toBeNull();
    now = 61_000;
    expect(cache.get("buffered")).toBeNull();
    expect(cache.get("long")?.client).toBe("long");
    now = 601_000;
    expect(cache.get("long")).toBeNull();
  });

  it("replaces entries, preserves save bookkeeping and supports explicit logout eviction", () => {
    let now = 0;
    const cache = new SessionCache<string>(1, () => now);
    cache.set("did", "old", undefined);
    now = 100;
    cache.markSaved("did");
    expect(cache.get("did")).toEqual({ client: "old", needsSave: false });
    cache.set("did", "new", undefined);
    expect(cache.get("did")?.client).toBe("new");
    expect(cache.stats().evicted).toBe(0);
    cache.delete("did");
    expect(cache.get("did")).toBeNull();
    expect(cache.stats().entries).toBe(0);
  });

  it("reclaims expired entries before evicting a live LRU entry", () => {
    let now = 0;
    const cache = new SessionCache<string>(2, () => now);
    cache.set("live", "live", undefined);
    cache.set("expired", "expired", 1);
    now = 10_000;
    cache.set("new", "new", undefined);
    expect(cache.get("live")?.client).toBe("live");
    expect(cache.stats()).toEqual({ entries: 2, capacity: 2, expired: 1, evicted: 0 });
  });
});
