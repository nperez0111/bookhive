import type { Database } from "../db";

/** Shared count/order semantics for the complete list API and lean HTML summaries. */
export function userListsQuery({ db, userDid }: { db: Database; userDid: string }) {
  return db
    .selectFrom("book_list")
    .select((eb) => [
      eb
        .selectFrom("book_list_item")
        .select(eb.fn.countAll<number>().as("count"))
        .whereRef("book_list_item.listUri", "=", "book_list.uri")
        .as("itemCount"),
    ])
    .where("book_list.userDid", "=", userDid)
    .orderBy("book_list.createdAt", "desc");
}

export function listShelfSummaries(options: { db: Database; userDid: string }) {
  return userListsQuery(options)
    .select([
      "book_list.uri",
      "book_list.userDid",
      "book_list.name",
      "book_list.description",
      "book_list.ordered",
    ])
    .execute();
}

/** Editing metadata never needs the items or the potentially large ranked itemOrder. */
export function getShelfMetadata({ db, listUri }: { db: Database; listUri: string }) {
  return db
    .selectFrom("book_list")
    .select(["uri", "userDid", "name", "description", "ordered"])
    .where("uri", "=", listUri)
    .executeTakeFirst();
}

export function buildShelfPreviewsQuery({ db, userDid }: { db: Database; userDid: string }) {
  return (
    db
      .selectFrom("book_list")
      .innerJoin("book_list_item", (join) =>
        join.on("book_list_item.uri", "in", (eb) =>
          eb
            .selectFrom("book_list_item as preview")
            .select("preview.uri")
            .whereRef("preview.listUri", "=", "book_list.uri")
            .orderBy("preview.addedAt", "desc")
            // Equal-date preview cutoffs used to be unspecified. Match the full
            // shelf's URI-ascending tie break, without applying its ranked order.
            .orderBy("preview.uri", "asc")
            .limit(10),
        ),
      )
      .leftJoin("hive_book", "book_list_item.hiveId", "hive_book.id")
      .select([
        "book_list_item.listUri",
        "book_list_item.hiveId",
        "book_list_item.embeddedTitle",
        "book_list_item.embeddedAuthor",
        "book_list_item.embeddedCoverUrl",
        "hive_book.cover",
        "hive_book.thumbnail",
        "hive_book.title",
        "hive_book.authors",
        "hive_book.rating",
      ])
      .where("book_list.userDid", "=", userDid)
      // IN selects membership, not order. Only the <=10-per-list winners sort here.
      .orderBy("book_list.uri", "asc")
      .orderBy("book_list_item.addedAt", "desc")
      .orderBy("book_list_item.uri", "asc")
  );
}

export function listShelfPreviews(options: { db: Database; userDid: string }) {
  return buildShelfPreviewsQuery(options).execute();
}
