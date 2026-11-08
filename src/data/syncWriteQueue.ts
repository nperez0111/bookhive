import type { Storage } from "unstorage";
import type { Database, SyncWriteQueueRow } from "../db";
import type { HiveId } from "../types";
import { isHiveId } from "../core/hiveId";
import { sql } from "kysely";

export type PendingWrite = { hiveId: HiveId; bookProgress: string };
export const SYNC_WRITE_LEASE_MS = 60_000;

/** Local publication authority for one tracked-row snapshot, not a remote PDS fence. */
export type SyncWritePublication = {
  userDid: string;
  hiveId: HiveId;
  uri: string;
  cid: string;
  revision: string;
  leaseToken: string;
};

export function syncWritePublicationIsCurrent(owner: SyncWritePublication) {
  return sql<boolean>`user_book.uri = ${owner.uri}
    AND user_book.cid = ${owner.cid}
    AND user_book.userDid = ${owner.userDid}
    AND user_book.hiveId = ${owner.hiveId}
    AND EXISTS (
      SELECT 1 FROM sync_write_queue q JOIN sync_write_state s ON s.userDid = q.userDid
      WHERE q.userDid = ${owner.userDid} AND q.hiveId = ${owner.hiveId}
        AND q.revision = ${owner.revision} AND s.leaseToken = ${owner.leaseToken}
    )`;
}

/** Read-only hint; acquisition and the post-import snapshot remain authoritative. */
export async function hasSyncWritesToDrain(db: Database, did: string) {
  const state = await db
    .selectNoFrom((eb) => [
      eb
        .exists(eb.selectFrom("sync_write_queue").select("userDid").where("userDid", "=", did))
        .as("pending"),
      eb
        .exists(
          eb
            .selectFrom("sync_write_state")
            .select("userDid")
            .where("userDid", "=", did)
            .where("legacyImported", "=", 1),
        )
        .as("imported"),
    ])
    .executeTakeFirstOrThrow();
  return Boolean(state.pending) || !state.imported;
}

/** Atomic per-book replacement; a completion may acknowledge only its own revision. */
export async function enqueuePdsWrite(db: Database, did: string, entry: PendingWrite) {
  await db
    .insertInto("sync_write_queue")
    .values({
      userDid: did,
      ...entry,
      revision: crypto.randomUUID(),
      enqueuedAt: new Date().toISOString(),
    })
    .onConflict((oc) =>
      oc.columns(["userDid", "hiveId"]).doUpdateSet((eb) => ({
        revision: eb.ref("excluded.revision"),
        bookProgress: eb.ref("excluded.bookProgress"),
        enqueuedAt: eb.ref("excluded.enqueuedAt"),
      })),
    )
    .execute();
}

export async function acquireSyncWriteLease(db: Database, did: string, now = Date.now()) {
  const token = crypto.randomUUID();
  const row = await db
    .insertInto("sync_write_state")
    .values({
      userDid: did,
      leaseToken: token,
      leaseUntil: now + SYNC_WRITE_LEASE_MS,
    })
    .onConflict((oc) =>
      oc
        .column("userDid")
        .doUpdateSet({
          leaseToken: token,
          leaseUntil: now + SYNC_WRITE_LEASE_MS,
        })
        .where((eb) =>
          eb.or([
            eb("sync_write_state.leaseUntil", "is", null),
            eb("sync_write_state.leaseUntil", "<=", now),
          ]),
        ),
    )
    .returning("leaseToken")
    .executeTakeFirst();
  return row?.leaseToken ?? null;
}

export async function renewSyncWriteLease(db: Database, did: string, token: string) {
  const result = await db
    .updateTable("sync_write_state")
    .set({ leaseUntil: Date.now() + SYNC_WRITE_LEASE_MS })
    .where("userDid", "=", did)
    .where("leaseToken", "=", token)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export async function releaseSyncWriteLease(db: Database, did: string, token: string) {
  await db
    .updateTable("sync_write_state")
    .set({ leaseToken: null, leaseUntil: null })
    .where("userDid", "=", did)
    .where("leaseToken", "=", token)
    .execute();
}

export async function acknowledgeSyncWrite(db: Database, entry: SyncWriteQueueRow, token: string) {
  await db
    .deleteFrom("sync_write_queue")
    .where("userDid", "=", entry.userDid)
    .where("hiveId", "=", entry.hiveId)
    .where("revision", "=", entry.revision)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("sync_write_state")
          .select("userDid")
          .where("userDid", "=", entry.userDid)
          .where("leaseToken", "=", token),
      ),
    )
    .execute();
}

/**
 * Import the old KV array once per DID. The durable marker and inserts commit together;
 * even a stale importer cannot resurrect an already acknowledged legacy entry. New SQL
 * entries always win. Keep the old mount only for this one-way upgrade.
 */
export async function importLegacySyncWrites(db: Database, kv: Storage, did: string) {
  const key = `sync_pending:${did}`;
  const state = await db
    .selectFrom("sync_write_state")
    .select("legacyImported")
    .where("userDid", "=", did)
    .executeTakeFirst();
  if (!state?.legacyImported) {
    const legacy = await kv.getItem<unknown>(key);
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto("sync_write_state")
        .values({ userDid: did, leaseToken: null, leaseUntil: null })
        .onConflict((oc) => oc.column("userDid").doNothing())
        .execute();
      const current = await tx
        .selectFrom("sync_write_state")
        .select("legacyImported")
        .where("userDid", "=", did)
        .executeTakeFirstOrThrow();
      if (current.legacyImported) return;
      if (Array.isArray(legacy)) {
        for (const entry of legacy) {
          if (!entry || !isHiveId(entry.hiveId) || typeof entry.bookProgress !== "string") continue;
          await tx
            .insertInto("sync_write_queue")
            .values({
              userDid: did,
              hiveId: entry.hiveId,
              bookProgress: entry.bookProgress,
              revision: crypto.randomUUID(),
              enqueuedAt: new Date().toISOString(),
            })
            .onConflict((oc) => oc.columns(["userDid", "hiveId"]).doNothing())
            .execute();
        }
      }
      await tx
        .updateTable("sync_write_state")
        .set({ legacyImported: 1 })
        .where("userDid", "=", did)
        .execute();
    });
    // Best effort after import; the marker makes a leftover key inert, so normal
    // drains need neither retry its removal nor touch legacy KV again.
    await kv.removeItem(key).catch(() => {});
  }
}
