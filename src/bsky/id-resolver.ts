import type { Storage } from "unstorage";
import type { ActorIdentifier, Handle } from "@atcute/lexicons/syntax";
import { isHandle } from "@atcute/lexicons/syntax";
import type { ActorResolver, DidDocumentResolver } from "@atcute/identity-resolver";
import {
  CompositeDidDocumentResolver,
  CompositeHandleResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { NodeDnsHandleResolver } from "@atcute/identity-resolver-node";

import { readThroughCache } from "../lib/readThroughCache";
import { Semaphore, withTimeout } from "../lib/semaphore";

let sharedDidDocumentResolver: DidDocumentResolver | undefined;

/**
 * The process-wide DID document resolver — memoised so the OAuth client, handle
 * resolvers, and service-auth verifier share one DID-document cache. Safe to share
 * because `noCache: true` (used on signature failure to recover from key rotation)
 * forwards through `CompositeDidDocumentResolver`.
 */
export function getDidDocumentResolver(): DidDocumentResolver {
  return (sharedDidDocumentResolver ??= new CompositeDidDocumentResolver({
    methods: {
      plc: new PlcDidDocumentResolver(),
      web: new WebDidDocumentResolver(),
    },
  }));
}

export function createActorResolver(): ActorResolver {
  const handleResolver = new CompositeHandleResolver({
    methods: {
      dns: new NodeDnsHandleResolver(),
      http: new WellKnownHandleResolver(),
    },
  });
  return new LocalActorResolver({
    handleResolver,
    didDocumentResolver: getDidDocumentResolver(),
  });
}

export type BaseIdResolver = {
  handle: { resolve(handle: string): Promise<string> };
};

export function createBaseIdResolver(): BaseIdResolver {
  const actorResolver = createActorResolver();
  return {
    handle: {
      resolve: async (handle: string): Promise<string> => {
        const actor = await actorResolver.resolve(handle as ActorIdentifier);
        return actor.did;
      },
    },
  };
}

const DEFAULT_IDENTITY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type IdentityCacheEntry = { did: string; handle: string };

export type CachingBaseIdResolverOptions = {
  ttl?: number;
};

// v2 ignores identities polluted by AppView's shared handle.invalid placeholder.
const IDENTITY_CACHE_PREFIX = "identity:v2:";

export function isUsableHandle(handle: unknown): handle is Handle {
  return isHandle(handle) && handle !== "handle.invalid";
}

/** Build cache keys only via these helpers — a bare DID key silently misses the `identity:` KV mount and is never read. */
function identityDidKey(did: string): string {
  return IDENTITY_CACHE_PREFIX + "did:" + did;
}

function identityHandleKey(handle: string): string {
  return IDENTITY_CACHE_PREFIX + "handle:" + handle.toLowerCase();
}

/** Serialize identity for storage (sqlite-kv expects string values). */
function identityCacheValue(entry: IdentityCacheEntry): string {
  return JSON.stringify(entry);
}

/** Writes both cache keys; awaits so the next request can hit the cache. */
export async function setIdentityCache(kv: Storage, did: string, handle: string): Promise<void> {
  if (!isUsableHandle(handle)) return;
  const value = identityCacheValue({ did, handle });
  const now = Date.now();
  const didKey = identityDidKey(did);
  const handleKey = identityHandleKey(handle);
  await Promise.all([
    kv.set(didKey, value),
    kv.setMeta(didKey, { timestamp: now }),
    kv.set(handleKey, value),
    kv.setMeta(handleKey, { timestamp: now }),
  ]);
}

function identityFromCache(raw: unknown): IdentityCacheEntry | null {
  if (typeof raw === "string" && raw) {
    try {
      const o = JSON.parse(raw) as IdentityCacheEntry;
      if (o && typeof o.did === "string" && typeof o.handle === "string") {
        return o;
      }
    } catch {
      // ignore
    }
  }
  if (raw && typeof raw === "object" && "did" in raw && "handle" in raw) {
    const o = raw as IdentityCacheEntry;
    if (typeof o.did === "string" && typeof o.handle === "string") {
      return o;
    }
  }
  return null;
}

/** On miss, writes both identity keys so DID->handle lookups also hit the cache. */
export function createCachingBaseIdResolver(
  kv: Storage,
  inner: BaseIdResolver,
  options: CachingBaseIdResolverOptions = {},
): BaseIdResolver {
  const ttl = options.ttl ?? DEFAULT_IDENTITY_CACHE_TTL_MS;

  return {
    handle: {
      resolve: async (handle: string): Promise<string> => {
        if (!isUsableHandle(handle)) return "";
        const key = identityHandleKey(handle);
        const raw = await readThroughCache(
          kv as Storage<string>,
          key,
          async () => {
            const did = await inner.handle.resolve(handle);
            if (did) await setIdentityCache(kv, did, handle);
            return identityCacheValue({ did, handle });
          },
          "",
          { revalidateAfter: ttl, ttl: 30 * 24 * 60 * 60 * 1000 },
        );
        const entry = identityFromCache(raw);
        if (entry) return entry.did;
        return "";
      },
    },
  };
}

export interface BidirectionalResolver {
  resolveDidToHandle(did: string): Promise<string>;
  resolveDidsToHandles(dids: string[]): Promise<Record<string, string>>;
}

// Shared across resolver instances and profile batches. Never release a slot on
// caller timeout: even an abort-ignoring transport must settle before it is reused.
// The upstream DNS/HTTP race can still leave uncancellable DNS losers after the
// actor promise settles; see docs/notes/data-and-caching.md.
const identityRequests = new Semaphore(3, {
  label: "identity resolution",
  maxPending: 12,
  acquireTimeoutMs: 500,
});

export function createBidirectionalResolverAtcute(
  actorResolver: ActorResolver = createActorResolver(),
): BidirectionalResolver {
  return {
    async resolveDidToHandle(did: string): Promise<string> {
      try {
        const actor = await withTimeout(
          identityRequests.run(() =>
            actorResolver.resolve(did as ActorIdentifier, { signal: AbortSignal.timeout(2500) }),
          ),
          3000,
          "identity resolution",
        );
        return isUsableHandle(actor.handle) ? actor.handle : did;
      } catch {
        return did;
      }
    },
    async resolveDidsToHandles(dids: string[]): Promise<Record<string, string>> {
      const didHandleMap: Record<string, string> = {};
      const resolves = await Promise.all(
        dids.map((did) => this.resolveDidToHandle(did).catch((_) => did)),
      );
      for (let i = 0; i < dids.length; i++) {
        didHandleMap[dids[i]!] = resolves[i]!;
      }
      return didHandleMap;
    },
  };
}

export type CachingBidirectionalResolverOptions = {
  /** TTL for identity cache in ms. Default 7 days. */
  ttl?: number;
};

/** Reads and writes only the new { did, handle } cache format. */
export function createCachingBidirectionalResolver(
  kv: Storage,
  inner: BidirectionalResolver,
  options: CachingBidirectionalResolverOptions = {},
): BidirectionalResolver {
  const ttl = options.ttl ?? DEFAULT_IDENTITY_CACHE_TTL_MS;

  return {
    async resolveDidToHandle(did: string): Promise<string> {
      const raw = await readThroughCache(
        kv as Storage<string>,
        identityDidKey(did),
        async () => {
          const handle = await inner.resolveDidToHandle(did);
          // Resolution failures are transient, not identities to retain for seven days.
          if (!isUsableHandle(handle)) throw new Error("Handle unavailable");
          // Write both directions so a DID->handle miss also warms the handle->DID side.
          await setIdentityCache(kv, did, handle);
          return identityCacheValue({ did, handle });
        },
        "",
        { revalidateAfter: ttl, ttl: 30 * 24 * 60 * 60 * 1000 },
      );
      const entry = identityFromCache(raw);
      return entry ? entry.handle : did;
    },
    async resolveDidsToHandles(dids: string[]): Promise<Record<string, string>> {
      const uniqueDids = [...new Set(dids)];
      const CONCURRENCY = 10;
      const handles: string[] = [];
      for (let i = 0; i < uniqueDids.length; i += CONCURRENCY) {
        const batch = uniqueDids.slice(i, i + CONCURRENCY);
        const batchHandles = await Promise.all(batch.map((did) => this.resolveDidToHandle(did)));
        handles.push(...batchHandles);
      }
      const didHandleMap: Record<string, string> = {};
      for (let i = 0; i < uniqueDids.length; i++) {
        didHandleMap[uniqueDids[i]!] = handles[i]!;
      }
      return didHandleMap;
    },
  };
}
