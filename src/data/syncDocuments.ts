import type { Database } from "../db";
import type { SyncProgressData } from "../types";
import { KOSYNC_PROVIDER } from "./syncBridge";
import { NO_HIVE_MATCH, SAME_BOOK_FILE } from "./syncMatching";

/**
 * **The one** read path for `sync_document`. Both KOSync REST routes, both
 * XRPC methods and `/library/sync/documents` are thin adapters over this — they
 * used to each parse the row separately and disagreed on `JSON.parse` guarding,
 * `hasFile`, and whether the `NO_HIVE_MATCH` sentinel was suppressed.
 *
 * The wire shapes stay in the adapters: KOSync answers `document` with a
 * numeric `percentage`, XRPC answers `documentHash` with a string one. Those
 * are lexicon- and protocol-visible and are not ours to unify here.
 */

/**
 * Parse a stored progress blob. Never throws — a row we cannot read is a row
 * with no progress, not a 500.
 */
export function parseSyncProgress(
  progressData: string | null | undefined,
): SyncProgressData | null {
  if (!progressData) return null;
  try {
    return JSON.parse(progressData) as SyncProgressData;
  } catch {
    return null;
  }
}

/** The lexicon's `syncProgressView`: absent when never synced or unreadable. */
export function syncProgressView(
  progressData: string | null | undefined,
  progressUpdatedAt: string | null | undefined,
): { percentage: string; device?: string; updatedAt: string } | undefined {
  if (!progressUpdatedAt) return undefined;
  const data = parseSyncProgress(progressData);
  if (!data) return undefined;
  return {
    percentage: String(data.percentage ?? 0),
    device: data.device || undefined,
    updatedAt: progressUpdatedAt,
  };
}

export type SyncDocumentView = {
  document: string;
  progress: string | undefined;
  percentage: number;
  device: string | null;
  deviceId: string | null;
  timestamp: number | undefined;
  filename: string | null;
  title: string | null;
  authors: string | null;
  updatedAt: string;
  /** Null when the user dismissed the match, so no client resolves `bk_none`. */
  hiveId: string | null;
  bookTitle: string | null;
  dismissed: boolean;
  /** True when an uploaded file matches this document — the library grid already shows it. */
  hasFile: boolean;
};

function toView(row: {
  document: string;
  progressData: string | null;
  filename: string | null;
  title: string | null;
  authors: string | null;
  updatedAt: string;
  hiveId: string | null;
  bookTitle?: string | null;
  hasFile?: unknown;
}): SyncDocumentView {
  const data = parseSyncProgress(row.progressData);
  const dismissed = row.hiveId === NO_HIVE_MATCH;
  return {
    document: row.document,
    progress: data?.progress,
    percentage: data?.percentage ?? 0,
    device: data?.device ?? null,
    deviceId: data?.device_id ?? null,
    timestamp: data?.timestamp,
    filename: row.filename,
    title: row.title,
    authors: row.authors,
    updatedAt: row.updatedAt,
    hiveId: dismissed ? null : row.hiveId,
    bookTitle: dismissed ? null : (row.bookTitle ?? null),
    dismissed,
    hasFile: Boolean(row.hasFile),
  };
}

export async function listSyncDocuments({
  db,
  userDid,
}: {
  db: Database;
  userDid: string;
}): Promise<SyncDocumentView[]> {
  const rows = await db
    .selectFrom("sync_document")
    .leftJoin("hive_book", "hive_book.id", "sync_document.hiveId")
    .select([
      "sync_document.documentHash as document",
      "sync_document.progressData as progressData",
      "sync_document.filename as filename",
      "sync_document.title as title",
      "sync_document.authors as authors",
      "sync_document.updatedAt as updatedAt",
      "sync_document.hiveId as hiveId",
      "hive_book.title as bookTitle",
    ])
    // A document we hold the file for is the same book: the library grid
    // renders it, so the sync sections must not claim it too. EXISTS rather
    // than a join because more than one upload can match one document.
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom("personal_book")
            .select("personal_book.id")
            .whereRef("personal_book.userDid", "=", "sync_document.userDid")
            .where(SAME_BOOK_FILE),
        )
        .as("hasFile"),
    )
    .where("sync_document.userDid", "=", userDid)
    .where("sync_document.provider", "=", KOSYNC_PROVIDER)
    .orderBy("sync_document.updatedAt", "desc")
    .execute();

  return rows.map(toView);
}

export async function getSyncDocument({
  db,
  userDid,
  document,
}: {
  db: Database;
  userDid: string;
  document: string;
}): Promise<SyncDocumentView | null> {
  const row = await db
    .selectFrom("sync_document")
    .leftJoin("hive_book", "hive_book.id", "sync_document.hiveId")
    .select([
      "sync_document.documentHash as document",
      "sync_document.progressData as progressData",
      "sync_document.filename as filename",
      "sync_document.title as title",
      "sync_document.authors as authors",
      "sync_document.updatedAt as updatedAt",
      "sync_document.hiveId as hiveId",
      "hive_book.title as bookTitle",
    ])
    .where("sync_document.userDid", "=", userDid)
    .where("sync_document.provider", "=", KOSYNC_PROVIDER)
    .where("sync_document.documentHash", "=", document)
    .executeTakeFirst();

  return row ? toView(row) : null;
}
