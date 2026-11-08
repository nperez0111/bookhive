import type { Storage } from "unstorage";
import type { Database } from "../db";
import {
  acquireSyncWriteLease,
  renewSyncWriteLease,
  releaseSyncWriteLease,
  acknowledgeSyncWrite,
  importLegacySyncWrites,
  SYNC_WRITE_LEASE_MS,
  type PendingWrite,
} from "../data/syncWriteQueue";

/** One bounded snapshot per session opportunity; failures remain queued for the next one. */
export async function drainSyncWrites({
  db,
  kv,
  userDid,
  write,
}: {
  db: Database;
  kv: Storage;
  userDid: string;
  write: (entry: PendingWrite) => Promise<void>;
}): Promise<void> {
  const token = await acquireSyncWriteLease(db, userDid);
  if (!token) return;
  let owned = true;
  // No overlap between renewals. A failed renewal stops subsequent writes/acknowledgements.
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing || !owned) return;
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
    for (const entry of pending) {
      if (!owned || !(await renewSyncWriteLease(db, userDid, token))) break;
      try {
        const tracked = await db
          .selectFrom("user_book")
          .select("uri")
          .where("userDid", "=", userDid)
          .where("hiveId", "=", entry.hiveId)
          .executeTakeFirst();
        if (tracked) await write(entry);
        if (owned) await acknowledgeSyncWrite(db, entry, token);
      } catch {
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
  } finally {
    clearInterval(timer);
    await renewing;
    await releaseSyncWriteLease(db, userDid, token);
  }
}
