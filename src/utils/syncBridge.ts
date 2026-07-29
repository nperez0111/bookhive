import type { Storage } from "unstorage";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { READING, FINISHED, ABANDONED } from "../constants";

export type PendingWrite = { hiveId: string; bookProgress: string };

/**
 * Queue a bookProgress write to the user's PDS, to be flushed when a session
 * agent is next available (KOSync requests carry no OAuth session). Deduped by
 * hiveId so the latest progress wins.
 */
export async function enqueuePdsWrite(
  kv: Storage,
  did: string,
  entry: PendingWrite,
): Promise<void> {
  const key = `sync_pending:${did}`;
  const existing = await kv.getItem<PendingWrite[]>(key);
  const list = existing ?? [];
  const idx = list.findIndex((e) => e.hiveId === entry.hiveId);
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  await kv.setItem(key, list);
}

/**
 * Bridge e-reader progress onto the user's BookHive book: writes bookProgress to
 * `user_book` optimistically (not dependent on the firehose) and queues a
 * deferred PDS write. No-op if the user does not track this book. `percentage`
 * is the KOReader fraction (0..1); the persisted `percent` is clamped to the
 * lexicon's 0..100 integer range.
 */
export async function bridgeProgressToUserBook(
  db: Database,
  kv: Storage,
  userDid: string,
  hiveId: HiveId,
  percentage: number,
): Promise<void> {
  const userBook = await db
    .selectFrom("user_book")
    .select(["uri", "status"])
    .where("userDid", "=", userDid)
    .where("hiveId", "=", hiveId)
    .executeTakeFirst();
  if (!userBook) return;

  const percent = Math.max(0, Math.min(100, Math.round(percentage * 100)));
  const bookProgress = JSON.stringify({ percent, updatedAt: new Date().toISOString() });

  const updates: Record<string, unknown> = { bookProgress };
  // Set status to "reading" if it isn't already finished or abandoned
  if (percent > 0 && userBook.status !== FINISHED && userBook.status !== ABANDONED) {
    updates["status"] = READING;
  }

  await db.updateTable("user_book").set(updates).where("uri", "=", userBook.uri).execute();
  await enqueuePdsWrite(kv, userDid, { hiveId, bookProgress });
}
