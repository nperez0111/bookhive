/**
 * Cross-process lock for OAuth token refresh.
 *
 * Uses SQLite INSERT OR IGNORE for atomic lock acquisition, safe across
 * multiple worker processes sharing the same database file (WAL mode).
 * Replaces the broken get-then-set lock that allowed concurrent refreshes.
 */
import { sql } from "kysely";
import type { KvDb } from "../sqlite-kv";

const OWNER = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

const STALE_LOCK_MS = 30_000;
const HEARTBEAT_MS = STALE_LOCK_MS / 3;

/**
 * Total time a request will wait for another process to finish refreshing.
 *
 * This was 250 attempts × a flat 150 ms = 37.5 s. On 2026-08-02 that was the
 * single worst thing in the codebase: when one user's PDS started blackholing
 * packets, the lock holder hung indefinitely (its heartbeat kept renewing the
 * row, so it was never evicted as stale) and every other request for that DID
 * — across all three worker processes — sat in this loop for the full 37.5 s.
 * Production showed a 38,000–39,600 ms plateau, an exact match.
 *
 * Worse than the wait was its cost: each attempt issues three SQLite statements
 * and `bun:sqlite` is synchronous, so a single waiter ran 750 blocking
 * statements on the event loop. Enough concurrent waiters and the worker stops
 * calling `accept()` entirely — Caddy's 166,450 `dial tcp: i/o timeout` 502s.
 *
 * The holder is now bounded independently (`restore-guard.ts` caps a restore at
 * 5 s), so a waiter that gets nowhere in 3 s is waiting on something already
 * known to be broken. Exponential backoff takes the statement count for a full
 * wait from 750 down to ~21.
 */
const MAX_WAIT_MS = 3_000;
const INITIAL_POLL_MS = 25;
const MAX_POLL_MS = 400;

/**
 * Poll/wait timings. Production never overrides these; the options exist so the
 * regression tests can prove the same give-up-then-clean-up behaviour without
 * spending the full real wait budget on every permanently-held-lock case.
 */
export type CrossProcessLockOptions = {
  maxWaitMs?: number;
  initialPollMs?: number;
  maxPollMs?: number;
};

export function createCrossProcessLock(
  db: KvDb,
  options: CrossProcessLockOptions = {},
): <T>(key: string, cb: () => Promise<T>) => Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
  const initialPollMs = options.initialPollMs ?? INITIAL_POLL_MS;
  const maxPollMs = options.maxPollMs ?? MAX_POLL_MS;

  void sql`CREATE TABLE IF NOT EXISTS auth_refresh_lock (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    acquired_at INTEGER NOT NULL
  )`.execute(db);

  return async function crossProcessLock<T>(key: string, cb: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + maxWaitMs;
    let pollMs = initialPollMs;

    for (;;) {
      const now = Date.now();

      // Evict stale locks from crashed processes before attempting acquisition.
      const cutoff = now - STALE_LOCK_MS;
      await sql`DELETE FROM auth_refresh_lock WHERE id = ${key} AND acquired_at < ${cutoff}`.execute(
        db,
      );

      // Atomic acquisition: only succeeds if no row exists for this key.
      await sql`INSERT OR IGNORE INTO auth_refresh_lock (id, owner, acquired_at) VALUES (${key}, ${OWNER}, ${now})`.execute(
        db,
      );

      // Verify we own the lock (separate read is safe — INSERT OR IGNORE is atomic,
      // so at most one process inserts; losers see the winner's row).
      const result = await sql<{
        owner: string;
      }>`SELECT owner FROM auth_refresh_lock WHERE id = ${key}`.execute(db);
      const holder = result.rows[0]?.owner;

      if (holder === OWNER) {
        // Renew the lock timestamp while the callback runs so other processes
        // don't evict it as stale during a legitimately slow refresh.
        const heartbeat = setInterval(() => {
          void sql`UPDATE auth_refresh_lock SET acquired_at = ${Date.now()} WHERE id = ${key} AND owner = ${OWNER}`.execute(
            db,
          );
        }, HEARTBEAT_MS);
        try {
          return await cb();
        } finally {
          clearInterval(heartbeat);
          await sql`DELETE FROM auth_refresh_lock WHERE id = ${key} AND owner = ${OWNER}`.execute(
            db,
          );
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
      pollMs = Math.min(pollMs * 2, maxPollMs);
    }

    // Only clean up our own lock (defensive no-op — we never acquired one).
    // Don't delete another process's legitimately-held lock.
    await sql`DELETE FROM auth_refresh_lock WHERE id = ${key} AND owner = ${OWNER}`.execute(db);
    throw new Error(`Cross-process lock timeout for ${key}`);
  };
}
