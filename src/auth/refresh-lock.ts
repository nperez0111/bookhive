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
const POLL_INTERVAL_MS = 150;
const MAX_ATTEMPTS = 250;

export function createCrossProcessLock(
  db: KvDb,
): <T>(key: string, cb: () => Promise<T>) => Promise<T> {
  void sql`CREATE TABLE IF NOT EXISTS auth_refresh_lock (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    acquired_at INTEGER NOT NULL
  )`.execute(db);

  return async function crossProcessLock<T>(key: string, cb: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Only clean up our own lock (defensive no-op — we never acquired one).
    // Don't delete another process's legitimately-held lock.
    await sql`DELETE FROM auth_refresh_lock WHERE id = ${key} AND owner = ${OWNER}`.execute(db);
    throw new Error(`Cross-process lock timeout for ${key}`);
  };
}
