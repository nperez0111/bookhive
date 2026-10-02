import { sql } from "kysely";
import type { Database } from "../db";
import type { HiveId } from "../types";

/** Genres for one book, in enrichment order (matches insert order into hive_book_genre). */
export async function loadGenresForHiveBook(db: Database, hiveId: HiveId): Promise<string[]> {
  const rows = await db
    .selectFrom("hive_book_genre")
    .select("genre")
    .where("hiveId", "=", hiveId)
    .orderBy(sql`rowid`)
    .execute();
  return rows.map((r) => r.genre);
}

export async function loadGenresMapForHiveBooks(
  db: Database,
  hiveIds: HiveId[],
): Promise<Map<HiveId, string[]>> {
  const map = new Map<HiveId, string[]>();
  if (hiveIds.length === 0) return map;
  const rows = await db
    .selectFrom("hive_book_genre")
    .select(["hiveId", "genre"])
    .where("hiveId", "in", hiveIds)
    .orderBy("hiveId")
    .orderBy(sql`rowid`)
    .execute();
  for (const { hiveId, genre } of rows) {
    const list = map.get(hiveId);
    if (list) list.push(genre);
    else map.set(hiveId, [genre]);
  }
  return map;
}
