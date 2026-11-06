import { expect, test } from "bun:test";
import { createStorage } from "unstorage";
import {
  createCachingBaseIdResolver,
  createCachingBidirectionalResolver,
  setIdentityCache,
} from "./id-resolver";

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
