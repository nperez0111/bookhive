import { afterEach, expect, jest, mock, test } from "bun:test";
import type { ActorResolver } from "@atcute/identity-resolver";
import { createStorage } from "unstorage";
import {
  createBaseIdResolver,
  createCachingBaseIdResolver,
  createCachingBidirectionalResolver,
  createBidirectionalResolverAtcute,
  setIdentityCache,
} from "./id-resolver";

// Yield through promise continuations without advancing the fake deadline clock.
const realSetImmediate = setImmediate;
const nextTurn = () => new Promise<void>((resolve) => realSetImmediate(resolve));
afterEach(() => jest.useRealTimers());

test("failed verification falls back to the DID without caching a placeholder", async () => {
  const kv = createStorage();
  const did = "did:plc:unresolved";
  let handle = "handle.invalid";
  const resolver = createCachingBidirectionalResolver(kv, {
    resolveDidToHandle: async () => handle,
    resolveDidsToHandles: async () => ({}),
  });
  expect(await resolver.resolveDidToHandle(did)).toBe(did);
  expect(await kv.get("identity:v2:did:" + did)).toBeNull();
  handle = "recovered.test";
  expect(await resolver.resolveDidToHandle(did)).toBe(handle);
});

test("identity traversal concurrency and queue are bounded across resolver instances, with abort", async () => {
  jest.useFakeTimers();
  let active = 0;
  let peak = 0;
  const signals: AbortSignal[] = [];
  const resolve: ActorResolver["resolve"] = mock(async (_did, options) => {
    const signal = options!.signal!;
    signals.push(signal);
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("unreachable");
    } finally {
      active--;
    }
  });
  const first = createBidirectionalResolverAtcute({ resolve });
  const second = createCachingBaseIdResolver(createStorage(), createBaseIdResolver({ resolve }));
  const dids = Array.from({ length: 25 }, (_, i) => `did:plc:overload${i}`);
  const pending = Promise.all(
    dids.map((did, i) =>
      i % 2 ? second.handle.resolve(`actor${i}.test`) : first.resolveDidToHandle(did),
    ),
  );
  await nextTurn();
  expect(signals).toHaveLength(3);
  jest.advanceTimersByTime(3000);
  expect(await pending).toEqual(dids.map((did, i) => (i % 2 ? "" : did)));
  expect(peak).toBe(3);
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(active).toBe(0);
});

test("timed-out identity traversals keep their slots until an abort-ignoring transport settles", async () => {
  jest.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const resolve = mock<ActorResolver["resolve"]>(async (did) => {
    if (resolve.mock.calls.length <= 3) await gate;
    return { did: did as `did:plc:${string}`, handle: "verified.test", pds: "https://pds.test/" };
  });
  const kv = createStorage();
  const resolver = createCachingBidirectionalResolver(
    kv,
    createBidirectionalResolverAtcute({ resolve }),
  );
  const base = createCachingBaseIdResolver(kv, createBaseIdResolver({ resolve }));
  const dids = ["a", "b", "c"].map((id) => `did:plc:held${id}`);
  try {
    const pending = Promise.all(dids.map((did) => resolver.resolveDidToHandle(did)));
    await nextTurn();
    expect(resolve).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(3000);
    expect(await pending).toEqual(dids);
    const queued = base.handle.resolve("queued.test");
    await nextTurn();
    jest.advanceTimersByTime(500);
    expect(await queued).toBe("");
    expect(resolve).toHaveBeenCalledTimes(3);
  } finally {
    release();
  }
  await nextTurn();
  expect(await resolver.resolveDidToHandle("did:plc:recovered")).toBe("verified.test");
  expect(resolve).toHaveBeenCalledTimes(4);
  for (const did of dids) expect(await kv.get("identity:v2:did:" + did)).toBeNull();
});

test("verified handle lookups preserve DID results and warm both cache directions", async () => {
  const kv = createStorage();
  const resolve = mock<ActorResolver["resolve"]>(async () => ({
    did: "did:plc:verified",
    handle: "verified.test",
    pds: "https://pds.test/",
  }));
  const base = createCachingBaseIdResolver(kv, createBaseIdResolver({ resolve }));
  expect(await base.handle.resolve("verified.test")).toBe("did:plc:verified");
  expect(await base.handle.resolve("verified.test")).toBe("did:plc:verified");
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(await kv.get("identity:v2:did:did:plc:verified")).toEqual({
    did: "did:plc:verified",
    handle: "verified.test",
  });
});

test("placeholder handles cannot overwrite either identity direction", async () => {
  const kv = createStorage();
  const did = "did:plc:alice";
  await setIdentityCache(kv, did, "alice.test");
  await setIdentityCache(kv, did, "handle.invalid");
  expect(await kv.get("identity:v2:handle:handle.invalid")).toBeNull();
  expect(await kv.get("identity:v2:did:" + did)).toEqual({ did, handle: "alice.test" });
});

test("legacy poisoned entries are ignored and placeholder routes never resolve", async () => {
  const kv = createStorage();
  const did = "did:plc:alice";
  await kv.set("identity:did:" + did, JSON.stringify({ did, handle: "handle.invalid" }));
  await kv.set("identity:handle:handle.invalid", JSON.stringify({ did, handle: "handle.invalid" }));
  const base = createCachingBaseIdResolver(kv, {
    handle: {
      resolve: async () => {
        throw new Error("must not resolve placeholder");
      },
    },
  });
  expect(await base.handle.resolve("handle.invalid")).toBe("");
  const resolver = createCachingBidirectionalResolver(kv, {
    resolveDidToHandle: async () => "alice.test",
    resolveDidsToHandles: async () => ({}),
  });
  expect(await resolver.resolveDidToHandle(did)).toBe("alice.test");
  expect(await kv.get("identity:v2:handle:alice.test")).toEqual({ did, handle: "alice.test" });
});
