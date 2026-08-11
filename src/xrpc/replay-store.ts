/**
 * Replay protection for service-auth JWTs.
 *
 * `ServiceJwtVerifier` calls `check({iss, jti}, ttl)` after it has verified the
 * signature (deliberately — a forged token must not be able to burn store
 * entries) and treats `false` as "seen before, reject".
 *
 * Written as a single `INSERT ... ON CONFLICT DO NOTHING` against the KV's own
 * SQLite connection rather than through unstorage's get-then-set. Production
 * runs four worker processes against one file, so a read followed by a write
 * would let two concurrent replays of the same token both observe "unseen".
 * One statement gives exactly one winner.
 */

import { sql } from "kysely";
import type { ReplayStore } from "@atcute/xrpc-server/auth";
import type { KvDb } from "../sqlite-kv";

/**
 * Its own table in the KV file, with the same `(id, value, created_at,
 * updated_at)` shape every unstorage mount uses — so the existing VACUUM and
 * incremental-vacuum sweeps cover it without special-casing.
 */
export const REPLAY_TABLE = "svc_jti";

export async function ensureReplayTable(kvDb: KvDb): Promise<void> {
  await kvDb.schema
    .createTable(REPLAY_TABLE)
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .execute();
}

export function createKvReplayStore(kvDb: KvDb): ReplayStore {
  return {
    async check({ iss, jti }, ttlSeconds) {
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const result = await sql<{ inserted: number }>`
        INSERT INTO ${sql.table(REPLAY_TABLE)} (id, value, created_at, updated_at)
        VALUES (${`${iss}|${jti}`}, ${expiresAt}, ${now}, ${now})
        ON CONFLICT(id) DO NOTHING
        RETURNING 1 as inserted
      `.execute(kvDb);
      return result.rows.length > 0;
    },
  };
}

/** Drop entries whose TTL has passed. Runs on the primary worker's 15m sweep. */
export async function sweepReplayStore(kvDb: KvDb): Promise<void> {
  await sql`DELETE FROM ${sql.table(REPLAY_TABLE)} WHERE value < ${new Date().toISOString()}`.execute(
    kvDb,
  );
}
