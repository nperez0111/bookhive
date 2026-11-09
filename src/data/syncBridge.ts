import type { Database } from "../db";
import type { HiveId } from "../types";
import { statusFromProgress, toPercent } from "../core/bookProgress";
import { matchSyncDocumentForUser, NO_HIVE_MATCH } from "./syncMatching";
import { filenameKey } from "../core/filenameMatching";
import type { SyncProgressData } from "../types";
import { enqueuePdsWrite } from "./syncWriteQueue";

/** The only sync provider today; `sync_document.provider` is keyed on it. */
export const KOSYNC_PROVIDER = "kosync";

/**
 * Bridge e-reader progress onto the user's BookHive book: writes bookProgress to
 * `user_book` optimistically (not dependent on the firehose) and queues a
 * deferred PDS write. No-op if the user does not track this book. `percentage`
 * is the KOReader fraction (0..1); the persisted `percent` is clamped to the
 * lexicon's 0..100 integer range.
 */
export async function bridgeProgressToUserBook(
  db: Database,
  userDid: string,
  hiveId: HiveId,
  percentage: number,
  source?: { id: number; progressData: string },
): Promise<void> {
  // A dismissed document has no BookHive book to bridge onto.
  if (hiveId === NO_HIVE_MATCH) return;

  await db.transaction().execute(async (tx) => {
    if (source) {
      const current = await tx
        .selectFrom("sync_document")
        .select("id")
        .where("id", "=", source.id)
        .where("userDid", "=", userDid)
        .where("hiveId", "=", hiveId)
        .where("progressData", "=", source.progressData)
        .executeTakeFirst();
      if (!current) return;
    }
    const userBook = await tx
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
    const inferred = percent > 0 ? statusFromProgress(userBook.status, { percent }) : undefined;
    if (inferred) {
      updates["status"] = inferred;
    }

    await tx.updateTable("user_book").set(updates).where("uri", "=", userBook.uri).execute();
    await enqueuePdsWrite(tx, userDid, { hiveId, bookProgress });
  });
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
  userDid,
  document,
  progress,
  percentage,
  device,
  deviceId,
  metadata,
}: {
  db: Database;
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

  // One statement owns creation and updates: simultaneous first pushes must
  // not race a SELECT against an INSERT. Omitted metadata and any existing
  // association (including dismissal) belong to the persisted document.
  const stored = await db
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
    .onConflict((oc) =>
      oc.columns(["userDid", "provider", "documentHash"]).doUpdateSet({
        progressData: JSON.stringify(progressData),
        updatedAt: now,
        ...(filename != null ? { filename, filenameKey: filenameKey(filename) } : {}),
        ...(title != null ? { title } : {}),
        ...(authors != null ? { authors } : {}),
      }),
    )
    .returning(["id", "hiveId", "filename", "title", "authors"])
    .executeTakeFirstOrThrow();

  let hiveId = stored.hiveId;

  // Unconditional: a default-configured KOReader sends no metadata at all, and
  // `matchSyncDocumentForUser` resolves those from the uploaded file the document hash points at.
  if (!hiveId) {
    const matchedHiveId = await matchSyncDocumentForUser(db, userDid, {
      documentHash: document,
      title: stored.title,
      authors: stored.authors,
      filename: stored.filename,
    });
    if (matchedHiveId) {
      await db
        .updateTable("sync_document")
        .set({ hiveId: matchedHiveId })
        .where("id", "=", stored.id)
        // Only fill a genuinely empty link — a concurrent request or a manual
        // link can land between the read above and this write, and this must
        // not clobber the NO_HIVE_MATCH dismissal sentinel either.
        .where("hiveId", "is", null)
        .execute();
    }

    // Matching yields to other requests. Even a miss may have raced a manual
    // link; always adopt the persisted winner before bridging or returning.
    const current = await db
      .selectFrom("sync_document")
      .select("hiveId")
      .where("id", "=", stored.id)
      .executeTakeFirst();
    hiveId = current?.hiveId ?? null;
  }

  if (hiveId) {
    await bridgeProgressToUserBook(db, userDid, hiveId, percentage, {
      id: stored.id,
      progressData: JSON.stringify(progressData),
    });
  }

  return { hiveId };
}
