/**
 * Shared route helpers: search, refetch, sync, ensure book identifiers.
 * Used by main router, import routes, and xrpc.
 */
import type { SessionClient } from "../auth/client";
import type { AppContext } from "../context";
import {
  ids,
  Book as BookRecord,
  Buzz as BuzzRecord,
  List as ListRecord,
  ListItem as ListItemRecord,
} from "../bsky/lexicon";
import type { HiveBook, HiveId } from "../types";
import { syncUserFollows, shouldSyncFollows } from "../utils/getFollows";
import { readThroughCache } from "../utils/readThroughCache";
import { findBookDetails } from "../scrapers";
import { enrichBookWithDetailedData } from "../utils/enrichBookData";
import { serializeUserBook } from "../utils/bookProgress";
import { upsertBookIdentifiers, upsertBookIdentifiersBatch } from "../utils/bookIdentifiers";
import { writeCatalogBookIfNeeded } from "../utils/catalogBookService";

export async function searchBooks({
  query,
  ctx,
}: {
  query: string;
  ctx: Pick<AppContext, "db" | "kv" | "addWideEventContext"> & {
    serviceAccountAgent?: AppContext["serviceAccountAgent"];
  };
}) {
  const combinedIds = await readThroughCache<HiveId[]>(
    ctx.kv,
    `search:${query}`,
    async () => {
      let goodreadsIds: HiveId[] = [];

      const res = await findBookDetails(query);
      if (res.success) {
        goodreadsIds = await ctx.db
          .insertInto("hive_book")
          .values(res.data)
          .onConflict((oc) =>
            oc.column("id").doUpdateSet((c) => {
              return {
                rating: c.ref("excluded.rating"),
                ratingsCount: c.ref("excluded.ratingsCount"),
                updatedAt: c.ref("excluded.updatedAt"),
                rawTitle: c.ref("excluded.rawTitle"),
              };
            }),
          )
          .execute()
          .then(() => res.data.map((book) => book.id));

        try {
          await upsertBookIdentifiersBatch(ctx.db, res.data);
        } catch (error) {
          ctx.addWideEventContext({
            search_book_identifiers_persist: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const enrichmentPromises = res.data.map((book) =>
          enrichBookWithDetailedData(book, ctx as AppContext).catch((error) => {
            ctx.addWideEventContext({
              enrichment_failed: true,
              bookId: book.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        );

        void Promise.allSettled(enrichmentPromises);
      }

      // Backfill from local DB with ILIKE to reach up to 20 results
      const pattern = `%${query}%`;
      const dbRows = await ctx.db
        .selectFrom("hive_book")
        .select("id")
        .where((eb) => eb.or([eb("rawTitle", "like", pattern), eb("authors", "like", pattern)]))
        .orderBy("ratingsCount", "desc")
        .orderBy("rating", "desc")
        .limit(20)
        .execute();

      const combined = [...goodreadsIds];
      for (const { id } of dbRows) {
        if (combined.length >= 20) break;
        if (!combined.includes(id)) combined.push(id);
      }

      return combined;
    },
    [] as HiveId[],
    {
      requestsPerSecond: 5,
    },
  );

  // Run catalog writes outside the cache so they fire on every call, including
  // cache hits where books may have been enriched since the result was cached.
  if (ctx.serviceAccountAgent && combinedIds.length > 0) {
    const catalogCtx = { db: ctx.db, serviceAccountAgent: ctx.serviceAccountAgent };
    void Promise.allSettled(
      combinedIds.map((bookId) =>
        writeCatalogBookIfNeeded(catalogCtx, bookId).catch((error) => {
          ctx.addWideEventContext({
            catalog_book_write_failed: true,
            bookId,
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      ),
    );
  }

  return combinedIds;
}

export async function ensureBookIdentifiersCurrent({
  ctx,
  book,
}: {
  ctx: AppContext;
  book: HiveBook;
}): Promise<void> {
  let latestBook = book;

  if (!latestBook.enrichedAt) {
    await enrichBookWithDetailedData(latestBook, ctx);

    const refreshedBook = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("id", "=", latestBook.id)
      .executeTakeFirst();

    if (refreshedBook) {
      latestBook = refreshedBook;
    }
  }

  await upsertBookIdentifiers(ctx.db, latestBook);
}

export async function syncFollowsIfNeeded({
  agent,
  ctx,
}: {
  agent: SessionClient;
  ctx: AppContext;
}) {
  if (!agent) {
    return;
  }

  try {
    const shouldSync = await shouldSyncFollows(ctx, agent.did);
    if (shouldSync) {
      await syncUserFollows(ctx, agent);
      ctx.addWideEventContext({
        follows_sync: "completed",
        userDid: agent.did,
      });
    }
  } catch (error) {
    ctx.addWideEventContext({
      follows_sync: "failed",
      userDid: agent.did,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type ListRecordsOut = {
  records: Array<{ uri: string; cid: string; value: unknown }>;
  cursor?: string;
};

export async function refetchBuzzes({
  agent,
  ctx,
  cursor,
  uris = [],
}: {
  agent: SessionClient;
  ctx: AppContext;
  cursor?: string;
  uris?: string[];
}) {
  if (!agent) {
    return;
  }
  const buzzesRes = await agent.get("com.atproto.repo.listRecords", {
    params: {
      repo: agent.did,
      collection: ids.BuzzBookhiveBuzz,
      limit: 100,
      cursor,
    },
  });
  if (!buzzesRes.ok) return;
  const buzzes = { data: buzzesRes.data as ListRecordsOut };

  await buzzes.data.records
    .filter((record) => BuzzRecord.validateRecord(record.value).success)
    .reduce(async (acc, record) => {
      await acc;
      const book = record.value as BuzzRecord.Record;

      const hiveId = (
        await ctx.db
          .selectFrom("user_book")
          .select("hiveId")
          .where("uri", "=", book.book.uri)
          .executeTakeFirst()
      )?.hiveId;

      if (!hiveId) {
        ctx.addWideEventContext({
          refetch_buzz_hive_id_missing: true,
          record_uri: record.uri,
        });
        return;
      }

      uris.push(record.uri);

      await ctx.db
        .insertInto("buzz")
        .values({
          uri: record.uri,
          cid: record.cid,
          userDid: agent.did,
          createdAt: book.createdAt,
          indexedAt: new Date().toISOString(),
          hiveId: hiveId,
          comment: book.comment,
          parentUri: book.parent.uri,
          parentCid: book.parent.cid,
          bookCid: book.book.cid,
          bookUri: book.book.uri,
        })
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet((c) => ({
            cid: c.ref("excluded.cid"),
            userDid: c.ref("excluded.userDid"),
            createdAt: c.ref("excluded.createdAt"),
            indexedAt: c.ref("excluded.indexedAt"),
            hiveId: c.ref("excluded.hiveId"),
            comment: c.ref("excluded.comment"),
            parentUri: c.ref("excluded.parentUri"),
            parentCid: c.ref("excluded.parentCid"),
            bookCid: c.ref("excluded.bookCid"),
            bookUri: c.ref("excluded.bookUri"),
          })),
        )
        .execute();
    }, Promise.resolve());

  if (buzzes.data.records.length === 100) {
    await new Promise((r) => setTimeout(r, 100));
    return refetchBuzzes({ agent, ctx, cursor: buzzes.data?.cursor, uris });
  } else {
    if (uris.length === 0) {
      await ctx.db.deleteFrom("buzz").where("userDid", "=", agent.did).execute();
    } else {
      await ctx.db
        .deleteFrom("buzz")
        .where("userDid", "=", agent.did)
        .where("uri", "not in", uris)
        .execute();
    }
  }
}

export async function refetchBooks({
  agent,
  ctx,
  cursor,
  uris = [],
  booksNeedingHiveUri = [],
}: {
  agent: SessionClient;
  ctx: AppContext;
  cursor?: string;
  uris?: string[];
  booksNeedingHiveUri?: Array<{
    rkey: string;
    hiveId: HiveId;
    record: import("../bsky/lexicon").Book.Record;
  }>;
}) {
  if (!agent) {
    return;
  }
  const bookRecordsRes = await agent.get("com.atproto.repo.listRecords", {
    params: {
      repo: agent.did,
      collection: ids.BuzzBookhiveBook,
      limit: 100,
      cursor,
    },
  });
  if (!bookRecordsRes.ok) return;
  const listData = bookRecordsRes.data as ListRecordsOut;
  const bookRecords = listData.records
    .filter((record) => BookRecord.validateRecord(record.value).success)
    .map((r) => ({ ...r, value: r.value as BookRecord.Record }));

  const duplicatesByHiveId = new Map<string, typeof bookRecords>();
  bookRecords.forEach((record) => {
    const hiveId = record.value.hiveId;
    if (hiveId) {
      if (!duplicatesByHiveId.has(hiveId)) {
        duplicatesByHiveId.set(hiveId, []);
      }
      duplicatesByHiveId.set(hiveId, [...duplicatesByHiveId.get(hiveId)!, record]);
    }
  });

  const promises: Promise<unknown>[] = [];

  Array.from(duplicatesByHiveId.values()).forEach((records) => {
    if (records.length > 1) {
      ctx.addWideEventContext({
        duplicate_books_resolved: records.length,
        records: records.map((r) => r.uri),
      });
      const [_recordToKeep, ...recordsToDelete] = records.sort((a, b) =>
        a.value.createdAt.localeCompare(b.value.createdAt),
      );

      recordsToDelete.forEach((r) => {
        const rkey = r.uri.split("/").pop()!;
        promises.push(
          agent.post("com.atproto.repo.deleteRecord", {
            input: {
              repo: agent.did,
              collection: ids.BuzzBookhiveBook,
              rkey,
            },
          }),
        );
        promises.push(
          ctx.db
            .deleteFrom("user_book")
            .where("uri", "=", r.uri)
            .where("userDid", "=", agent.did)
            .execute(),
        );
      });
    }
  });

  await bookRecords.reduce(async (acc, record) => {
    await acc;
    const book = record.value;

    promises.push(searchBooks({ query: book.title, ctx }));

    uris.push(record.uri);

    if (!book.hiveBookUri) {
      const rkey = record.uri.split("/").at(-1)!;
      booksNeedingHiveUri.push({ rkey, hiveId: book.hiveId as HiveId, record: book });
    }

    await ctx.db
      .insertInto("user_book")
      .values(
        serializeUserBook({
          uri: record.uri,
          cid: record.cid,
          userDid: agent.did,
          createdAt: book.createdAt,
          title: book.title,
          authors: book.authors,
          indexedAt: new Date().toISOString(),
          hiveId: book.hiveId as HiveId,
          status: book.status,
          owned: book.owned ? 1 : 0,
          startedAt: book.startedAt,
          finishedAt: book.finishedAt,
          review: book.review,
          stars: book.stars,
          bookProgress: book.bookProgress ?? null,
        }),
      )
      .onConflict((oc) =>
        oc.column("uri").doUpdateSet((c) => ({
          cid: c.ref("excluded.cid"),
          userDid: c.ref("excluded.userDid"),
          createdAt: c.ref("excluded.createdAt"),
          indexedAt: c.ref("excluded.indexedAt"),
          title: c.ref("excluded.title"),
          authors: c.ref("excluded.authors"),
          status: c.ref("excluded.status"),
          owned: c.ref("excluded.owned"),
          startedAt: c.ref("excluded.startedAt"),
          finishedAt: c.ref("excluded.finishedAt"),
          hiveId: c.ref("excluded.hiveId"),
          review: c.ref("excluded.review"),
          stars: c.ref("excluded.stars"),
          bookProgress: c.ref("excluded.bookProgress"),
        })),
      )
      .execute();
  }, Promise.resolve());

  await Promise.all(promises);
  if (listData.records.length === 100) {
    await new Promise((r) => setTimeout(r, 10));
    return refetchBooks({
      agent,
      ctx,
      cursor: listData.cursor,
      uris,
      booksNeedingHiveUri,
    });
  } else {
    if (uris.length === 0) {
      await ctx.db.deleteFrom("user_book").where("userDid", "=", agent.did).execute();
    } else {
      await ctx.db
        .deleteFrom("user_book")
        .where("userDid", "=", agent.did)
        .where("uri", "not in", uris)
        .execute();
    }

    // Backfill hiveBookUri on user's book records if any are missing it
    if (booksNeedingHiveUri.length > 0) {
      const hiveIds = [...new Set(booksNeedingHiveUri.map((b) => b.hiveId as HiveId))];
      const hiveBookRows = await ctx.db
        .selectFrom("hive_book")
        .select(["id", "hiveBookAtUri"])
        .where("id", "in", hiveIds)
        .execute();
      const hiveBookUriMap = new Map(
        hiveBookRows.filter((r) => r.hiveBookAtUri).map((r) => [r.id as HiveId, r.hiveBookAtUri!]),
      );

      const writes = booksNeedingHiveUri
        .filter((b) => hiveBookUriMap.has(b.hiveId as HiveId))
        .map((b) => ({
          $type: "com.atproto.repo.applyWrites#update",
          collection: ids.BuzzBookhiveBook,
          rkey: b.rkey,
          value: { ...b.record, hiveBookUri: hiveBookUriMap.get(b.hiveId as HiveId) },
        }));

      for (let i = 0; i < writes.length; i += 200) {
        const response = await agent.post("com.atproto.repo.applyWrites", {
          input: { repo: agent.did, writes: writes.slice(i, i + 200) },
        });
        if (!response.ok) {
          throw new Error(
            `applyWrites hiveBookUri backfill failed: data=${JSON.stringify(response.data)}`,
          );
        }
      }
    }
  }
}

export async function refetchLists({ agent, ctx }: { agent: SessionClient; ctx: AppContext }) {
  if (!agent) return;

  // 1. Sync lists
  const listUris: string[] = [];
  let listCursor: string | undefined;
  do {
    const res = await agent.get("com.atproto.repo.listRecords", {
      params: {
        repo: agent.did,
        collection: ids.SocialPopfeedFeedList,
        limit: 100,
        cursor: listCursor,
      },
    });
    if (!res.ok) return;
    const data = res.data as ListRecordsOut;

    for (const record of data.records) {
      if (!ListRecord.validateRecord(record.value).success) continue;
      const list = record.value as ListRecord.Record;

      listUris.push(record.uri);
      await ctx.db
        .insertInto("book_list")
        .values({
          uri: record.uri,
          cid: record.cid,
          userDid: agent.did,
          name: list.name,
          description: list.description ?? null,
          ordered: list.ordered ? 1 : 0,
          tags: list.tags ? JSON.stringify(list.tags) : null,
          createdAt: list.createdAt,
          indexedAt: new Date().toISOString(),
        })
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet((c) => ({
            cid: c.ref("excluded.cid"),
            name: c.ref("excluded.name"),
            description: c.ref("excluded.description"),
            ordered: c.ref("excluded.ordered"),
            tags: c.ref("excluded.tags"),
            indexedAt: c.ref("excluded.indexedAt"),
          })),
        )
        .execute();
    }

    listCursor = data.records.length === 100 ? data.cursor : undefined;
  } while (listCursor);

  // Clean up deleted lists
  if (listUris.length === 0) {
    await ctx.db.deleteFrom("book_list").where("userDid", "=", agent.did).execute();
  } else {
    await ctx.db
      .deleteFrom("book_list")
      .where("userDid", "=", agent.did)
      .where("uri", "not in", listUris)
      .execute();
  }

  // 2. Sync list items
  const itemUris: string[] = [];
  let itemCursor: string | undefined;
  do {
    const res = await agent.get("com.atproto.repo.listRecords", {
      params: {
        repo: agent.did,
        collection: ids.SocialPopfeedFeedListItem,
        limit: 100,
        cursor: itemCursor,
      },
    });
    if (!res.ok) return;
    const data = res.data as ListRecordsOut;

    for (const record of data.records) {
      if (!ListItemRecord.validateRecord(record.value).success) continue;
      const item = record.value as ListItemRecord.Record;

      // Only process book items
      if (item.creativeWorkType !== "book") continue;

      // Resolve hiveId: check identifiers.hiveId first, then fall back to ISBN
      let hiveId: HiveId | null = (item.identifiers?.hiveId as HiveId) ?? null;

      if (!hiveId && (item.identifiers?.isbn13 || item.identifiers?.isbn10)) {
        const idRow = await ctx.db
          .selectFrom("book_id_map")
          .select("hiveId")
          .where((eb) =>
            eb.or([
              ...(item.identifiers?.isbn13 ? [eb("isbn13", "=", item.identifiers.isbn13)] : []),
              ...(item.identifiers?.isbn10 ? [eb("isbn", "=", item.identifiers.isbn10)] : []),
            ]),
          )
          .executeTakeFirst();
        if (idRow) hiveId = idRow.hiveId;
      }

      itemUris.push(record.uri);
      await ctx.db
        .insertInto("book_list_item")
        .values({
          uri: record.uri,
          cid: record.cid,
          userDid: agent.did,
          listUri: item.listUri,
          hiveId,
          description: item.description ?? null,
          position: item.position ?? null,
          addedAt: item.addedAt,
          indexedAt: new Date().toISOString(),
          embeddedTitle: item.title ?? null,
          embeddedAuthor: item.mainCredit ?? null,
          embeddedCoverUrl: item.posterUrl ?? null,
          identifiers: item.identifiers ? JSON.stringify(item.identifiers) : null,
        })
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet((c) => ({
            cid: c.ref("excluded.cid"),
            listUri: c.ref("excluded.listUri"),
            hiveId: c.ref("excluded.hiveId"),
            description: c.ref("excluded.description"),
            position: c.ref("excluded.position"),
            indexedAt: c.ref("excluded.indexedAt"),
            embeddedTitle: c.ref("excluded.embeddedTitle"),
            embeddedAuthor: c.ref("excluded.embeddedAuthor"),
            embeddedCoverUrl: c.ref("excluded.embeddedCoverUrl"),
            identifiers: c.ref("excluded.identifiers"),
          })),
        )
        .execute();
    }

    itemCursor = data.records.length === 100 ? data.cursor : undefined;
  } while (itemCursor);

  // Clean up deleted items
  if (itemUris.length === 0) {
    await ctx.db.deleteFrom("book_list_item").where("userDid", "=", agent.did).execute();
  } else {
    await ctx.db
      .deleteFrom("book_list_item")
      .where("userDid", "=", agent.did)
      .where("uri", "not in", itemUris)
      .execute();
  }
}
