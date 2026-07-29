import type { Database } from "../db";
import type { HiveId } from "../types";
import { getHiveId } from "../scrapers/getHiveId";

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
