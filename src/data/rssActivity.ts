import type { Database } from "../db";
import type { HiveId } from "../types";

/** RSS renders mirrored user-book fields only, including the complete review. */
export function buildRssActivityQuery(
  db: Database,
  scope:
    | { kind: "user"; did: string }
    | { kind: "book"; hiveId: HiveId }
    | { kind: "friends"; did: string },
  { limit, statusFilter }: { limit: number; statusFilter: string[] | null },
) {
  let query = db
    .selectFrom("user_book")
    .select([
      "uri",
      "hiveId",
      "title",
      "authors",
      "status",
      "stars",
      "review",
      "createdAt",
      "indexedAt",
      "userDid",
    ])
    .orderBy("user_book.indexedAt", "desc")
    .orderBy("user_book.uri", "desc")
    .limit(limit);

  if (scope.kind === "user") {
    query = query.where("user_book.userDid", "=", scope.did);
  } else if (scope.kind === "book") {
    query = query.where("user_book.hiveId", "=", scope.hiveId);
  } else {
    query = query.where(
      "user_book.userDid",
      "in",
      db
        .selectFrom("user_follows")
        .where("userDid", "=", scope.did)
        .where("isActive", "=", 1)
        .select("followsDid"),
    );
  }
  if (statusFilter) query = query.where("user_book.status", "in", statusFilter);
  return query;
}

export function listRssActivityRows(...args: Parameters<typeof buildRssActivityQuery>) {
  return buildRssActivityQuery(...args).execute();
}
