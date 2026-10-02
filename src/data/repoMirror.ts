import type { Database } from "../db";

/**
 * Reconciling a user's locally-mirrored records with what their PDS actually
 * holds: a re-sync must delete what it did not see, not just upsert what it did.
 *
 * `uri not in ()` is not expressible, so an empty `keepUris` needs its own
 * branch rather than being guarded away — guarding the whole delete on
 * `length > 0` would silently turn "the user deleted every record of this
 * kind" into "change nothing". Empty is not a no-op; it is the strongest
 * possible instruction.
 */
export async function pruneMirroredRecords({
  db,
  table,
  userDid,
  keepUris,
}: {
  db: Database;
  table: "user_book" | "buzz";
  userDid: string;
  /** Every URI the PDS returned for this user. Empty means "they have none". */
  keepUris: string[];
}): Promise<number> {
  let query = db.deleteFrom(table).where("userDid", "=", userDid);
  if (keepUris.length > 0) {
    query = query.where("uri", "not in", keepUris);
  }
  const result = await query.executeTakeFirst();
  return Number(result?.numDeletedRows ?? 0);
}
