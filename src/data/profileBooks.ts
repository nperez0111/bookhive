import type { Database } from "../db";

/** Every field used by the public profile book views, including full text/history. */
const ProfileWireFields = [
  "user_book.authors",
  "user_book.createdAt",
  "user_book.finishedAt",
  "user_book.hiveId",
  "user_book.indexedAt",
  "user_book.review",
  "user_book.stars",
  "user_book.startedAt",
  "user_book.status",
  "user_book.owned",
  "user_book.title",
  "user_book.userDid",
  "user_book.bookProgress",
  "user_book.previousReads",
  "hive_book.cover",
  "hive_book.thumbnail",
  "hive_book.description",
  "hive_book.rating",
] as const;

export function buildProfileBooksQuery({
  db,
  userDid,
  scope,
}: {
  db: Database;
  userDid: string;
  scope: "library" | "friends";
}) {
  const query = db
    .selectFrom("user_book")
    .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
    .select(ProfileWireFields)
    .orderBy("user_book.indexedAt", "desc")
    .orderBy("user_book.uri", "desc");
  return scope === "library"
    ? query.where("user_book.userDid", "=", userDid).limit(10_000)
    : query
        .innerJoin("user_follows", "user_book.userDid", "user_follows.followsDid")
        .where("user_follows.userDid", "=", userDid)
        .where("user_follows.isActive", "=", 1)
        .limit(50);
}

export function listProfileWireBooks(options: Parameters<typeof buildProfileBooksQuery>[0]) {
  return buildProfileBooksQuery(options).execute();
}
