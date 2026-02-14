import { IdResolver } from "@atproto/identity";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { ActorResolver } from "@atcute/identity-resolver";
import type { Storage } from "unstorage";
import {
  CompositeDidDocumentResolver,
  CompositeHandleResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { NodeDnsHandleResolver } from "@atcute/identity-resolver-node";
import { StorageCache } from "../utils/didUnstorageCache";

/** Create ActorResolver for OAuth (handle/DID resolution). */
export function createActorResolver(): ActorResolver {
  const handleResolver = new CompositeHandleResolver({
    methods: {
      dns: new NodeDnsHandleResolver(),
      http: new WellKnownHandleResolver(),
    },
  });
  const didDocumentResolver = new CompositeDidDocumentResolver({
    methods: {
      plc: new PlcDidDocumentResolver(),
      web: new WebDidDocumentResolver(),
    },
  });
  return new LocalActorResolver({
    handleResolver,
    didDocumentResolver,
  });
}

const HOUR = 60e3 * 60;
const DAY = HOUR * 24;
const WEEK = HOUR * 7;

export function createIdResolver(kv: Storage) {
  return new IdResolver({
    didCache: new StorageCache({
      store: kv,
      prefix: "didCache:",
      staleTTL: DAY,
      maxTTL: WEEK,
    }),
  });
}

export interface BidirectionalResolver {
  resolveDidToHandle(did: string): Promise<string>;
  resolveDidsToHandles(dids: string[]): Promise<Record<string, string>>;
}

/** Create BidirectionalResolver using @atproto/identity IdResolver (used when passing to Firehose). */
export function createBidirectionalResolver(resolver: IdResolver) {
  return {
    async resolveDidToHandle(did: string): Promise<string> {
      const didDoc = await resolver.did.resolveAtprotoData(did);
      resolver.handle.resolve(didDoc.handle).then((resolvedHandle) => {
        if (resolvedHandle !== did) {
          resolver.did.ensureResolve(did, true);
        }
      });
      return didDoc?.handle ?? did;
    },
    async resolveDidsToHandles(
      dids: string[],
    ): Promise<Record<string, string>> {
      const didHandleMap: Record<string, string> = {};
      const resolves = await Promise.all(
        dids.map((did) => this.resolveDidToHandle(did).catch((_) => did)),
      );
      for (let i = 0; i < dids.length; i++) {
        didHandleMap[dids[i]] = resolves[i];
      }
      return didHandleMap;
    },
  };
}

/** Create BidirectionalResolver using @atcute/identity-resolver (for app routes; does not require @atproto/identity). */
export function createBidirectionalResolverAtcute(): BidirectionalResolver {
  const actorResolver = createActorResolver();

  return {
    async resolveDidToHandle(did: string): Promise<string> {
      try {
        const actor = await actorResolver.resolve(did as ActorIdentifier);
        return actor.handle;
      } catch {
        return did;
      }
    },
    async resolveDidsToHandles(
      dids: string[],
    ): Promise<Record<string, string>> {
      const didHandleMap: Record<string, string> = {};
      const resolves = await Promise.all(
        dids.map((did) => this.resolveDidToHandle(did).catch((_) => did)),
      );
      for (let i = 0; i < dids.length; i++) {
        didHandleMap[dids[i]] = resolves[i];
      }
      return didHandleMap;
    },
  };
}
