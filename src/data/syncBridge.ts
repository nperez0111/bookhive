import type { Storage } from "unstorage";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { statusFromProgress, toPercent } from "../core/bookProgress";
import { matchSyncDocumentForUser, NO_HIVE_MATCH } from "./syncMatching";
import { filenameKey } from "../core/filenameMatching";
import type { SyncProgressData } from "../types";

/** The only sync provider today; `sync_document.provider` is keyed on it. */
export const KOSYNC_PROVIDER = "kosync";

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
  // A dismissed document has no BookHive book to bridge onto.
  if (hiveId === NO_HIVE_MATCH) return;

  const userBook = await db
    .selectFrom("user_book")
    .select(["uri", "status"])
    .where("userDid", "=", userDid)
    .where("hiveId", "=", hiveId)
    .executeTakeFirst();
  if (!userBook) return;

  const percent = toPercent(percentage);
  const bookProgress = JSON.stringify({ percent, updatedAt: new Date().toISOString() });

  const updates: Record<string, unknown> = { bookProgress };
  // Zero percent is excluded: an e-reader reports it for a book merely opened, not yet reading.
  const inferred = percent > 0 ? statusFromProgress(userBook.status) : undefined;
  if (inferred) {
    updates["status"] = inferred;
  }

  await db.updateTable("user_book").set(updates).where("uri", "=", userBook.uri).execute();
  await enqueuePdsWrite(kv, userDid, { hiveId, bookProgress });
}

/**
 * **The one** "an e-reader pushed progress for this document": upsert
 * `sync_document`, auto-link it to a book if it isn't linked yet, and bridge the
 * percentage onto `user_book`. `PUT /kosync/syncs/progress` and the
 * `putSyncProgress` XRPC procedure are thin adapters over this — they used to
 * be line-for-line copies.
 *
 * The adapters keep only what is transport-shaped: KOSync hand-validates its
 * JSON body, XRPC gets that from the lexicon and parses `percentage` from a
 * string.
 */
export async function recordSyncProgress({
  db,
  kv,
  userDid,
  document,
  progress,
  percentage,
  device,
  deviceId,
  metadata,
}: {
  db: Database;
  kv: Storage;
  userDid: string;
  document: string;
  progress: string;
  percentage: number;
  device: string;
  deviceId: string;
  metadata?: { filename?: string; title?: string; authors?: string } | undefined;
}): Promise<{ hiveId: HiveId | null }> {
  const now = new Date().toISOString();
  const filename = metadata?.filename ?? null;
  const title = metadata?.title ?? null;
  const authors = metadata?.authors ?? null;

  const progressData: SyncProgressData = {
    progress,
    percentage,
    device,
    device_id: deviceId,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const existing = await db
    .selectFrom("sync_document")
    .select(["id", "hiveId"])
    .where("userDid", "=", userDid)
    .where("provider", "=", KOSYNC_PROVIDER)
    .where("documentHash", "=", document)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable("sync_document")
      .set({
        progressData: JSON.stringify(progressData),
        updatedAt: now,
        ...(filename != null ? { filename, filenameKey: filenameKey(filename) } : {}),
        ...(title != null ? { title } : {}),
        ...(authors != null ? { authors } : {}),
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await db
      .insertInto("sync_document")
      .values({
        userDid,
        provider: KOSYNC_PROVIDER,
        documentHash: document,
        hiveId: null,
        filename,
        filenameKey: filenameKey(filename),
        title,
        authors,
        progressData: JSON.stringify(progressData),
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }

  let hiveId = existing?.hiveId ?? null;

  // Unconditional: a default-configured KOReader sends no metadata at all, and
  // `matchSyncDocumentForUser` resolves those from the uploaded file the document hash points at.
  if (!hiveId) {
    hiveId = await matchSyncDocumentForUser(db, userDid, {
      documentHash: document,
      title,
      authors,
      filename,
    });
    if (hiveId) {
      await db
        .updateTable("sync_document")
        .set({ hiveId })
        .where("userDid", "=", userDid)
        .where("provider", "=", KOSYNC_PROVIDER)
        .where("documentHash", "=", document)
        // Only fill a genuinely empty link — a concurrent request or a manual
        // link can land between the read above and this write, and this must
        // not clobber the NO_HIVE_MATCH dismissal sentinel either.
        .where("hiveId", "is", null)
        .execute();
    }
  }

  if (hiveId) {
    await bridgeProgressToUserBook(db, kv, userDid, hiveId as HiveId, percentage);
  }

  return { hiveId: (hiveId as HiveId) ?? null };
}
