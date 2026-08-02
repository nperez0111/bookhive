/**
 * Shared cache for rendered OG cards, backed by the SQLite KV (`og:` mount).
 *
 * This replaced ocache's `defineCachedFunction`, whose default store is a plain
 * `Map` with TTL timers and **no size cap or eviction**, holding webp bytes as
 * `Uint8Array` — native memory, invisible to `heapUsed`, duplicated across
 * every worker process, for a TTL of up to seven days. Production traffic is a
 * crawler sweeping the catalog (674 distinct cards in three hours at a 4.4% hit
 * rate), so that Map only ever grew.
 *
 * On the KV it is bounded by disk instead of RAM, one copy serves every worker,
 * and it survives restarts — a crawler sweep costs one render per card rather
 * than one per card per process per deploy.
 *
 * Deliberately free of the OG render worker and the logger: `src/context.ts`
 * imports this for the sweep, and pulling in `src/routes/og.tsx` there creates
 * an import cycle through the worker client's module-scope pino instance.
 */
import { sql } from "kysely";
import type { Storage } from "unstorage";

import type { KvDb } from "../sqlite-kv";
import { ogCacheBytes, ogCacheEntries } from "../metrics";

/** Longest OG TTL (TTL.STATIC in src/routes/og.tsx), used to size the sweep. */
export const OG_CACHE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedOg = { b64: string; expiresAt: number };

/**
 * Per-process in-flight renders. A crawler burst on one cold URL would
 * otherwise start a render per concurrent request. Holds the promise, never the
 * bytes, and is always deleted in `finally`.
 */
const inflight = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

/**
 * Buffer.from() can hand back a view into a shared pool, so copy into a
 * standalone ArrayBuffer and let the Response own exactly its own bytes.
 */
function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(b64, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

export function ogCacheKey(kind: string, props: unknown): string {
  return `og:${kind}:${Bun.hash(JSON.stringify(props)).toString(36)}`;
}

export async function cachedOgRender(
  kv: Storage,
  key: string,
  ttlSeconds: number,
  render: () => Promise<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const hit = await kv.get<CachedOg>(key).catch(() => null);
  if (hit && hit.expiresAt > Date.now()) return decodeBase64(hit.b64);

  const existing = inflight.get(key);
  if (existing) return existing;

  const work = (async () => {
    const bytes = new Uint8Array(await render()) as Uint8Array<ArrayBuffer>;
    // Best effort: a KV write failure must not fail the image.
    await kv
      .set(key, {
        b64: Buffer.from(bytes).toString("base64"),
        expiresAt: Date.now() + ttlSeconds * 1000,
      } satisfies CachedOg)
      .catch(() => {});
    return bytes;
  })();

  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

/** Publish cache size to /metrics. Primary worker only — it is shared state. */
export async function publishOgCacheStats(kvDb: KvDb): Promise<void> {
  const row = await sql<{
    n: number;
    b: number | null;
  }>`SELECT count(*) AS n, sum(length(value)) AS b FROM og_cache`.execute(kvDb);
  ogCacheEntries.set(Number(row.rows[0]?.n ?? 0));
  ogCacheBytes.set(Number(row.rows[0]?.b ?? 0));
}
