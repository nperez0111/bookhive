import { withTimeout } from "../lib/semaphore";

type RepoPage = {
  repos: { did: string; active?: boolean }[];
  cursor?: string;
};

/** Public directory only: never put admin credentials or viewer state here. */
export function createRepoLister(
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<RepoPage>,
  { now = Date.now, timeoutMs = 2_500 }: { now?: () => number; timeoutMs?: number } = {},
): () => Promise<string[]> {
  const freshFor = 5 * 60_000;
  const staleFor = 24 * 60 * 60_000;
  let snapshot: { dids: string[]; timestamp: number } | undefined;
  let retryAt = 0;
  let inFlight: Promise<string[]> | undefined;
  let transportRunning = false;

  function fallback(): string[] {
    return snapshot && now() - snapshot.timestamp < staleFor ? snapshot.dids : [];
  }

  function refresh(): Promise<string[]> {
    if (inFlight) return inFlight;
    // A timed-out transport may ignore abort. Do not start another traversal
    // until the original actually settles, even after the retry backoff.
    if (transportRunning) return Promise.resolve(fallback());
    transportRunning = true;
    const controller = new AbortController();
    const work = (async () => {
      const dids = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      // One deadline covers the complete traversal, not a fresh timeout per
      // page. A broken/repeating cursor cannot run forever or poison the cache
      // with a partial list. Ten pages permits 10,000 hosted accounts.
      for (let page = 0; page < 10; page++) {
        const result = await fetchPage(cursor, controller.signal);
        controller.signal.throwIfAborted();
        for (const repo of result.repos) {
          if (repo.active !== false) dids.add(repo.did);
        }
        cursor = result.cursor;
        if (!cursor) return [...dids];
        if (cursors.has(cursor)) throw new Error("PDS directory repeated a cursor");
        cursors.add(cursor);
      }
      throw new Error("PDS directory exceeded page limit");
    })().finally(() => {
      transportRunning = false;
    });
    inFlight = withTimeout(work, timeoutMs, "PDS directory")
      .then((dids) => {
        snapshot = { dids, timestamp: now() };
        retryAt = 0;
        return dids;
      })
      .catch(() => {
        retryAt = now() + 30_000;
        return fallback();
      })
      .finally(() => {
        controller.abort();
        inFlight = undefined;
      });
    return inFlight;
  }

  return async () => {
    const age = snapshot ? now() - snapshot.timestamp : Infinity;
    if (snapshot && age < freshFor) return snapshot.dids;
    if (snapshot && age < staleFor) {
      if (now() >= retryAt) void refresh();
      return snapshot.dids;
    }
    if (now() < retryAt) return [];
    return refresh();
  };
}
