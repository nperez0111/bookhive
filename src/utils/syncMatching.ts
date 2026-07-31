import type { Database } from "../db";
import type { HiveId } from "../types";
import { getHiveId } from "../scrapers/getHiveId";

/**
 * Sentinel written to `sync_document.hiveId` when the user asserts a synced
 * document has no BookHive counterpart. Shaped like a HiveId so the column type
 * holds, but it can never collide with a real `hive_book.id` (those are content
 * hashes). Because every auto-match path only runs when `hiveId` is falsy, the
 * sentinel also permanently stops re-matching — which is the point.
 *
 * Read paths must translate it outward as `{ hiveId: null, dismissed: true }`
 * so no client ever links to `/books/bk_none`.
 */
export const NO_HIVE_MATCH = "bk_none" as HiveId;

export async function matchSyncDocument(
  db: Database,
  metadata: { title?: string | null; authors?: string | null; filename?: string | null },
): Promise<HiveId | null> {
  const { title, authors } = metadata;
  if (!title) return null;

  const authorStr = authors || "Unknown";

  // Exact match only: the derived HiveId is a hash of the normalized
  // title + author. A confident hit auto-bridges to the user's book; anything
  // else is left unlinked for the user to connect manually, so we never write
  // progress to the wrong book. The sync_document row (and its progress) is
  // stored regardless, so e-reader sync itself is unaffected by a miss.
  const candidateId = getHiveId({ title, authors: authorStr });
  const exact = await db
    .selectFrom("hive_book")
    .select("id")
    .where("id", "=", candidateId)
    .executeTakeFirst();
  if (exact) return exact.id;

  return null;
}
