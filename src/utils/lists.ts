/**
 * List CRUD utilities: PDS writes + local DB mirroring.
 */
import * as TID from "@atcute/tid";
import { ids } from "../bsky/lexicon/ids.js";
import type { SessionClient } from "../auth/client";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { loadGenresForHiveBook } from "./hiveBookGenres.js";
import { sql } from "kysely";

type ListDeps = {
  agent: SessionClient;
  db: Database;
};

export async function createList({
  agent,
  db,
  name,
  description,
  ordered,
  tags,
}: ListDeps & {
  name: string;
  description?: string;
  ordered?: boolean;
  tags?: string[];
}): Promise<{ uri: string; cid: string }> {
  const now = new Date().toISOString();
  const rkey = TID.now();

  const record = {
    $type: ids.SocialPopfeedFeedList,
    name,
    description,
    ordered: ordered ?? false,
    tags,
    createdAt: now,
  };

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#create",
          collection: ids.SocialPopfeedFeedList,
          rkey,
          value: record,
        },
      ],
    },
  });

  if (!response.ok) {
    throw new Error("Failed to create list on PDS");
  }

  const applyData = response.data as {
    results: Array<{ $type: string; uri: string; cid: string }>;
  };
  const result = applyData.results[0];
  if (!result || result.$type !== "com.atproto.repo.applyWrites#createResult") {
    throw new Error("Failed to create list record");
  }

  await db
    .insertInto("book_list")
    .values({
      uri: result.uri,
      cid: result.cid,
      userDid: agent.did,
      name,
      description: description ?? null,
      ordered: ordered ? 1 : 0,
      tags: tags ? JSON.stringify(tags) : null,
      createdAt: now,
      indexedAt: now,
    })
    .execute();

  return { uri: result.uri, cid: result.cid };
}

export async function updateList({
  agent,
  db,
  uri,
  name,
  description,
  ordered,
  tags,
}: ListDeps & {
  uri: string;
  name?: string;
  description?: string;
  ordered?: boolean;
  tags?: string[];
}): Promise<{ uri: string; cid: string }> {
  const existing = await db
    .selectFrom("book_list")
    .selectAll()
    .where("uri", "=", uri)
    .executeTakeFirst();

  if (!existing) throw new Error("List not found");
  if (existing.userDid !== agent.did) throw new Error("Not authorized to update this list");

  const rkey = uri.split("/").at(-1)!;

  // Fetch current record from PDS to get full value for update
  const getRes = await agent.get("com.atproto.repo.getRecord", {
    params: {
      repo: agent.did,
      collection: ids.SocialPopfeedFeedList,
      rkey,
    },
  });
  if (!getRes.ok) throw new Error("Failed to fetch list record from PDS");
  const currentRecord = (getRes.data as { value: Record<string, unknown> }).value;

  const updatedRecord = {
    ...currentRecord,
    name: name ?? existing.name,
    description: description !== undefined ? description : existing.description,
    ordered: ordered !== undefined ? ordered : Boolean(existing.ordered),
    tags: tags !== undefined ? tags : existing.tags ? JSON.parse(existing.tags) : undefined,
  };

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#update",
          collection: ids.SocialPopfeedFeedList,
          rkey,
          value: updatedRecord,
        },
      ],
    },
  });

  if (!response.ok) throw new Error("Failed to update list on PDS");

  const applyData = response.data as {
    results: Array<{ $type: string; uri: string; cid: string }>;
  };
  const result = applyData.results[0];
  if (!result || result.$type !== "com.atproto.repo.applyWrites#updateResult") {
    throw new Error("Failed to update list record");
  }

  await db
    .updateTable("book_list")
    .set({
      cid: result.cid,
      name: name ?? existing.name,
      description: description !== undefined ? description || null : existing.description,
      ordered: ordered !== undefined ? (ordered ? 1 : 0) : existing.ordered,
      tags: tags !== undefined ? (tags ? JSON.stringify(tags) : null) : existing.tags,
      indexedAt: new Date().toISOString(),
    })
    .where("uri", "=", uri)
    .execute();

  return { uri: result.uri, cid: result.cid };
}

export async function deleteList({ agent, db, uri }: ListDeps & { uri: string }): Promise<void> {
  const existing = await db
    .selectFrom("book_list")
    .selectAll()
    .where("uri", "=", uri)
    .executeTakeFirst();

  if (!existing) throw new Error("List not found");
  if (existing.userDid !== agent.did) throw new Error("Not authorized to delete this list");

  // Get all items for this list to delete from PDS
  const items = await db
    .selectFrom("book_list_item")
    .select("uri")
    .where("listUri", "=", uri)
    .execute();

  const writes: Array<Record<string, unknown>> = [];

  // Delete all items
  for (const item of items) {
    writes.push({
      $type: "com.atproto.repo.applyWrites#delete",
      collection: ids.SocialPopfeedFeedListItem,
      rkey: item.uri.split("/").at(-1)!,
    });
  }

  // Delete the list itself
  writes.push({
    $type: "com.atproto.repo.applyWrites#delete",
    collection: ids.SocialPopfeedFeedList,
    rkey: uri.split("/").at(-1)!,
  });

  // Batch in groups of 200 (PDS limit)
  for (let i = 0; i < writes.length; i += 200) {
    const response = await agent.post("com.atproto.repo.applyWrites", {
      input: { repo: agent.did, writes: writes.slice(i, i + 200) },
    });
    if (!response.ok) throw new Error("Failed to delete list from PDS");
  }

  // Delete from local DB
  await db.deleteFrom("book_list_item").where("listUri", "=", uri).execute();
  await db.deleteFrom("book_list").where("uri", "=", uri).execute();
}

export async function addBookToList({
  agent,
  db,
  listUri,
  hiveId,
  description,
  position,
}: ListDeps & {
  listUri: string;
  hiveId: HiveId;
  description?: string;
  position?: number;
}): Promise<{ uri: string; cid: string }> {
  const list = await db
    .selectFrom("book_list")
    .selectAll()
    .where("uri", "=", listUri)
    .executeTakeFirst();

  if (!list) throw new Error("List not found");
  if (list.userDid !== agent.did) throw new Error("Not authorized to modify this list");

  // Get book metadata for the PDS record
  const book = await db
    .selectFrom("hive_book")
    .selectAll()
    .where("id", "=", hiveId)
    .executeTakeFirst();

  if (!book) throw new Error("Book not found");

  const listItemGenres = await loadGenresForHiveBook(db, hiveId);

  // Get book identifiers for cross-app interop
  const idRow = await db
    .selectFrom("book_id_map")
    .selectAll()
    .where("hiveId", "=", hiveId)
    .executeTakeFirst();

  const now = new Date().toISOString();
  const rkey = TID.now();

  const identifiers: Record<string, string> = { hiveId };
  if (idRow?.isbn) identifiers["isbn10"] = idRow.isbn;
  if (idRow?.isbn13) identifiers["isbn13"] = idRow.isbn13;

  const authors: string[] = book.authors.split("\t");

  const record = {
    $type: ids.SocialPopfeedFeedListItem,
    creativeWorkType: "book",
    identifiers,
    title: book.title,
    mainCredit: authors[0],
    mainCreditRole: "author",
    posterUrl: book.cover ?? book.thumbnail,
    genres: listItemGenres.length > 0 ? listItemGenres : undefined,
    listUri,
    addedAt: now,
    description,
    position,
  };

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#create",
          collection: ids.SocialPopfeedFeedListItem,
          rkey,
          value: record,
        },
      ],
    },
  });

  if (!response.ok) throw new Error("Failed to add book to list on PDS");

  const applyData = response.data as {
    results: Array<{ $type: string; uri: string; cid: string }>;
  };
  const result = applyData.results[0];
  if (!result || result.$type !== "com.atproto.repo.applyWrites#createResult") {
    throw new Error("Failed to create list item record");
  }

  await db
    .insertInto("book_list_item")
    .values({
      uri: result.uri,
      cid: result.cid,
      userDid: agent.did,
      listUri,
      hiveId,
      description: description ?? null,
      position: position ?? null,
      addedAt: now,
      indexedAt: now,
      embeddedTitle: null,
      embeddedAuthor: null,
      embeddedCoverUrl: null,
      identifiers: JSON.stringify(identifiers),
    })
    .execute();

  return { uri: result.uri, cid: result.cid };
}

export async function removeBookFromList({
  agent,
  db,
  itemUri,
}: ListDeps & { itemUri: string }): Promise<void> {
  const item = await db
    .selectFrom("book_list_item")
    .selectAll()
    .where("uri", "=", itemUri)
    .executeTakeFirst();

  if (!item) throw new Error("List item not found");
  if (item.userDid !== agent.did) throw new Error("Not authorized to modify this list");

  const rkey = itemUri.split("/").at(-1)!;

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: ids.SocialPopfeedFeedListItem,
          rkey,
        },
      ],
    },
  });

  if (!response.ok) throw new Error("Failed to remove book from list on PDS");

  await db.deleteFrom("book_list_item").where("uri", "=", itemUri).execute();
}

export async function reorderListItems({
  agent,
  db,
  listUri,
  itemUris,
}: ListDeps & {
  listUri: string;
  itemUris: string[];
}): Promise<void> {
  const list = await db
    .selectFrom("book_list")
    .selectAll()
    .where("uri", "=", listUri)
    .executeTakeFirst();

  if (!list) throw new Error("List not found");
  if (list.userDid !== agent.did) throw new Error("Not authorized to modify this list");

  // Update the list record on PDS with new itemOrder
  const rkey = listUri.split("/").at(-1)!;
  const getRes = await agent.get("com.atproto.repo.getRecord", {
    params: {
      repo: agent.did,
      collection: ids.SocialPopfeedFeedList,
      rkey,
    },
  });
  if (!getRes.ok) throw new Error("Failed to fetch list record from PDS");
  const currentRecord = (getRes.data as { value: Record<string, unknown> }).value;

  const updatedRecord = {
    ...currentRecord,
    itemOrder: itemUris,
  };

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#update",
          collection: ids.SocialPopfeedFeedList,
          rkey,
          value: updatedRecord,
        },
      ],
    },
  });

  if (!response.ok) throw new Error("Failed to update list order on PDS");

  // Update positions in local DB
  const caseFragments = itemUris.map((uri, idx) => sql`WHEN ${uri} THEN ${idx}`);
  if (caseFragments.length > 0) {
    await db
      .updateTable("book_list_item")
      .set({
        position: sql`CASE uri ${sql.join(caseFragments, sql` `)} END`,
        indexedAt: new Date().toISOString(),
      })
      .where("uri", "in", itemUris)
      .execute();
  }
}

export async function getUserLists({ db, userDid }: { db: Database; userDid: string }) {
  return db
    .selectFrom("book_list")
    .selectAll()
    .select((eb) => [
      eb
        .selectFrom("book_list_item")
        .select(eb.fn.countAll<number>().as("count"))
        .whereRef("book_list_item.listUri", "=", "book_list.uri")
        .as("itemCount"),
    ])
    .where("userDid", "=", userDid)
    .orderBy("createdAt", "desc")
    .execute();
}

export async function getListWithItems({ db, listUri }: { db: Database; listUri: string }) {
  const list = await db
    .selectFrom("book_list")
    .selectAll()
    .where("uri", "=", listUri)
    .executeTakeFirst();

  if (!list) return null;

  const items = await db
    .selectFrom("book_list_item")
    .leftJoin("hive_book", "book_list_item.hiveId", "hive_book.id")
    .select([
      "book_list_item.uri",
      "book_list_item.cid",
      "book_list_item.hiveId",
      "book_list_item.description",
      "book_list_item.position",
      "book_list_item.addedAt",
      "book_list_item.embeddedTitle",
      "book_list_item.embeddedAuthor",
      "book_list_item.embeddedCoverUrl",
      "book_list_item.identifiers",
      "hive_book.title",
      "hive_book.authors",
      "hive_book.thumbnail",
      "hive_book.cover",
      "hive_book.rating",
    ])
    .where("book_list_item.listUri", "=", listUri)
    .orderBy("book_list_item.position", "asc")
    .orderBy("book_list_item.addedAt", "desc")
    .execute();

  return { list, items };
}
