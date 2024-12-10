import { IdResolver } from "@atproto/identity";
import type { Storage } from "unstorage";
import { StorageCache } from "../utils/didUnstorageCache";

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

export function createBidirectionalResolver(resolver: IdResolver) {
  return {
    async resolveDidToHandle(did: string): Promise<string> {
      const didDoc = await resolver.did.resolveAtprotoData(did);

      // asynchronously double check that the handle resolves back
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
