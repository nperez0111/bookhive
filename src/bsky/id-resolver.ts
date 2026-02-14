import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { ActorResolver } from "@atcute/identity-resolver";
import {
  CompositeDidDocumentResolver,
  CompositeHandleResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { NodeDnsHandleResolver } from "@atcute/identity-resolver-node";

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

export type BaseIdResolver = {
  handle: { resolve(handle: string): Promise<string> };
};

/** Create resolver that resolves handle -> DID (for app routes). */
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

export interface BidirectionalResolver {
  resolveDidToHandle(did: string): Promise<string>;
  resolveDidsToHandles(dids: string[]): Promise<Record<string, string>>;
}

/** Create BidirectionalResolver using @atcute/identity-resolver (DID -> handle). */
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
