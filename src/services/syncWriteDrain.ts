import type { Storage } from "unstorage";
import type { Database } from "../db";
import { errorMessage } from "../lib/errors";
import {
  hasSyncWritesToDrain,
  acquireSyncWriteLease,
  renewSyncWriteLease,
  releaseSyncWriteLease,
  acknowledgeSyncWrite,
  importLegacySyncWrites,
  SYNC_WRITE_LEASE_MS,
  type PendingWrite,
  type SyncWritePublication,
} from "../data/syncWriteQueue";

export type SyncWriteDrainSummary = {
  selected: number;
  attempted: number;
  failed: number;
  remaining: number;
  lease_lost: boolean;
  duration_ms: number;
  last_error?: string;
};

/** At most 100 entries per session opportunity, not a wall-clock bound. */
export async function drainSyncWrites({
  db,
  kv,
  userDid,
  write,
  onStalled,
}: {
  db: Database;
  kv: Storage;
  userDid: string;
  write: (entry: PendingWrite, publication: SyncWritePublication) => Promise<void>;
  onStalled?: (durationMs: number) => void;
}): Promise<SyncWriteDrainSummary | null> {
  // A producer arriving after this read waits for another session opportunity,
  // just as one arriving after the authoritative snapshot below does.
  if (!(await hasSyncWritesToDrain(db, userDid))) return null;
  const token = await acquireSyncWriteLease(db, userDid);
  if (!token) return null;
  const startedAt = Date.now();
  let activeWriteStartedAt: number | undefined;
  let warned = false;
  let owned = true;
  // No overlap between renewals. A failed renewal stops subsequent writes/acknowledgements.
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing || !owned) return;
    // Observe a stuck transport, but never release a live operation's owner.
    if (
      !warned &&
      activeWriteStartedAt !== undefined &&
      Date.now() - activeWriteStartedAt >= SYNC_WRITE_LEASE_MS
    ) {
      warned = true;
      onStalled?.(Date.now() - activeWriteStartedAt);
    }
    renewing = renewSyncWriteLease(db, userDid, token)
      .then((renewed) => {
        owned = renewed;
      })
      .catch(() => {
        owned = false;
      })
      .finally(() => {
        renewing = undefined;
      });
    return renewing;
  }, SYNC_WRITE_LEASE_MS / 4);
  timer.unref();
  try {
    await importLegacySyncWrites(db, kv, userDid);
    const pending = await db
      .selectFrom("sync_write_queue")
      .selectAll()
      .where("userDid", "=", userDid)
      .orderBy("enqueuedAt")
      .orderBy("hiveId")
      .limit(100)
      .execute();
    if (!pending.length) return null;
    let attempted = 0;
    let failed = 0;
    let lastError: string | undefined;
    for (const entry of pending) {
      if (!owned) break;
      owned = await renewSyncWriteLease(db, userDid, token);
      if (!owned) break;
      try {
        const tracked = await db
          .selectFrom("user_book")
          .select(["uri", "cid"])
          .where("userDid", "=", userDid)
          .where("hiveId", "=", entry.hiveId)
          .executeTakeFirst();
        if (tracked) {
          attempted++;
          activeWriteStartedAt = Date.now();
          try {
            await write(entry, {
              userDid,
              hiveId: entry.hiveId,
              uri: tracked.uri,
              cid: tracked.cid,
              revision: entry.revision,
              leaseToken: token,
            });
          } finally {
            activeWriteStartedAt = undefined;
          }
        }
        if (owned) await acknowledgeSyncWrite(db, entry, token);
      } catch (error) {
        failed++;
        lastError = errorMessage(error);
        // Keep this revision, without rewriting or deleting any newer producer's work.
        // Rotate the failed revision behind unattempted work so a failing first
        // hundred cannot permanently starve the rest of this user's queue.
        await db
          .updateTable("sync_write_queue")
          .set({ enqueuedAt: new Date().toISOString() })
          .where("userDid", "=", userDid)
          .where("hiveId", "=", entry.hiveId)
          .where("revision", "=", entry.revision)
          .execute();
      }
    }
    const remaining = await db
      .selectFrom("sync_write_queue")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("userDid", "=", userDid)
      .executeTakeFirstOrThrow();
    return {
      selected: pending.length,
      attempted,
      failed,
      remaining: Number(remaining.count),
      lease_lost: !owned,
      duration_ms: Date.now() - startedAt,
      ...(lastError ? { last_error: lastError } : {}),
    };
  } finally {
    clearInterval(timer);
    await renewing;
    await releaseSyncWriteLease(db, userDid, token);
  }
}
