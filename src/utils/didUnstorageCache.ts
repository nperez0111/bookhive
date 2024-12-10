import {
  type CacheResult,
  type DidDocument,
  type DidCache,
} from "@atproto/identity";
import type { Storage } from "unstorage";

const HOUR = 60e3 * 60;
const DAY = HOUR * 24;

type CacheVal = {
  doc: DidDocument;
  updatedAt: number;
};

/**
 * An unstorage based DidCache with staleness and max TTL
 */
export class StorageCache implements DidCache {
  public staleTTL: number;
  public maxTTL: number;
  public cache: Storage<CacheVal>;
  private prefix: string;
  constructor({
    store,
    prefix,
    staleTTL,
    maxTTL,
  }: {
    store: Storage;
    prefix: string;
    staleTTL?: number;
    maxTTL?: number;
  }) {
    this.cache = store;
    this.prefix = prefix;
    this.staleTTL = staleTTL ?? HOUR;
    this.maxTTL = maxTTL ?? DAY;
  }

  async cacheDid(did: string, doc: DidDocument): Promise<void> {
    await this.cache.set(this.prefix + did, { doc, updatedAt: Date.now() });
  }

  async refreshCache(
    did: string,
    getDoc: () => Promise<DidDocument | null>,
  ): Promise<void> {
    const doc = await getDoc();
    if (doc) {
      await this.cacheDid(did, doc);
    }
  }

  async checkCache(did: string): Promise<CacheResult | null> {
    const val = await this.cache.get<CacheVal>(this.prefix + did);
    if (!val) return null;
    const now = Date.now();
    const expired = now > val.updatedAt + this.maxTTL;
    const stale = now > val.updatedAt + this.staleTTL;
    return {
      ...val,
      did,
      stale,
      expired,
    };
  }

  async clearEntry(did: string): Promise<void> {
    await this.cache.remove(this.prefix + did);
  }

  async clear(): Promise<void> {
    await this.cache.clear(this.prefix);
  }
}
