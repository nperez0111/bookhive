// Cross-process OAuth refresh lock via SQLite INSERT OR IGNORE, safe across worker processes sharing the DB file (WAL mode).
import { sql } from "kysely";
import type { KvDb } from "../sqlite-kv";

const OWNER = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

const STALE_LOCK_MS = 30_000;
const HEARTBEAT_MS = STALE_LOCK_MS / 3;

// Bounded wait for another process's refresh — was unbounded (flat-interval polling) and caused a production incident when a lock holder hung on a dead PDS. The holder is now independently bounded (`restore-guard.ts` caps a restore at 5s), so a waiter that gets nowhere quickly is waiting on something already known to be broken; exponential backoff keeps the poll count small.
const MAX_WAIT_MS = 3_000;
const INITIAL_POLL_MS = 25;
const MAX_POLL_MS = 400;

// Poll/wait timings. Production never overrides these; the options exist so tests can exercise the same give-up-then-clean-up behaviour without the full wait budget.
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

      // Evict stale locks from crashed processes first.
      const cutoff = now - STALE_LOCK_MS;
      await sql`DELETE FROM auth_refresh_lock WHERE id = ${key} AND acquired_at < ${cutoff}`.execute(
        db,
      );

      // Atomic acquisition: only succeeds if no row exists for this key.
      await sql`INSERT OR IGNORE INTO auth_refresh_lock (id, owner, acquired_at) VALUES (${key}, ${OWNER}, ${now})`.execute(
        db,
      );

      // Separate read is safe — INSERT OR IGNORE is atomic, so at most one process inserts and losers see the winner's row.
      const result = await sql<{
        owner: string;
      }>`SELECT owner FROM auth_refresh_lock WHERE id = ${key}`.execute(db);
      const holder = result.rows[0]?.owner;

      if (holder === OWNER) {
        // Renew the timestamp while the callback runs so it isn't evicted as stale during a legitimately slow refresh.
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

    // Defensive no-op — only ever deletes our own lock, never another process's.
    await sql`DELETE FROM auth_refresh_lock WHERE id = ${key} AND owner = ${OWNER}`.execute(db);
    throw new Error(`Cross-process lock timeout for ${key}`);
  };
}
