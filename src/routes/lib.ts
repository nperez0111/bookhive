/**
 * Shared route helpers: search, refetch, sync, ensure book identifiers.
 * Used by main router, import routes, and xrpc.
 */
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import type { SessionClient } from "../auth/client";
import type { AppEnv, AppContext } from "../context";
import {
  ids,
  Book as BookRecord,
  Buzz as BuzzRecord,
  List as ListRecord,
  ListItem as ListItemRecord,
} from "../bsky/lexicon";
import type { HiveBook, HiveId } from "../types";
import { syncUserFollows, shouldSyncFollows } from "../services/getFollows";
import { warmCatalogSearch } from "../services/searchBooks";
import { pruneMirroredRecords } from "../data/repoMirror";
import { NO_STORE, hasSessionCookie } from "../core/cacheHeaders";
import { enqueueEnrichment } from "../data/enrichQueue";
import { serializeUserBook } from "../core/bookProgress";
import { buzzUpsertSet, userBookUpsertSet } from "../db";
import { upsertBookIdentifiers } from "../data/bookIdentifiers";
import { errorMessage } from "../lib/errors";

/**
 * Sets Cache-Control on successful responses; never overrides a header the
 * handler already set. `directive` applies to anonymous requests only — a
 * signed-in request always gets `private, no-store`, mirroring
 * server/plugins/cache-headers.ts for the non-nitro `bun run src/server.ts` path.
 */
export const cacheControl = (directive: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    await next();
    if (hasSessionCookie(c.req.header("cookie"))) {
      c.header("Cache-Control", NO_STORE);
      return;
    }
    if (!c.res.headers.has("Cache-Control") && c.res.status < 400) {
      c.header("Cache-Control", directive);
    }
  });

/**
 * In-handler form of {@link cacheControl}, for routes that set their header up
 * front rather than through middleware. Same rule: `directive` is the anonymous
 * value, a signed-in request gets `private, no-store`.
 */
export function setCacheControl(c: Context<AppEnv>, directive: string): void {
  c.header("Cache-Control", hasSessionCookie(c.req.header("cookie")) ? NO_STORE : directive);
}

export async function ensureBookIdentifiersCurrent({
  ctx,
  book,
}: {
  ctx: AppContext;
  book: HiveBook;
}): Promise<void> {
  // Never block a response on a Goodreads scrape — enqueue it and persist
  // whatever identifiers exist now, letting the queue backfill the rest.
  if (!book.enrichedAt) {
    // Best-effort: a failed queue write must not break the read path.
    try {
      await enqueueEnrichment(ctx.db, book.id);
    } catch (error) {
      ctx.addWideEventContext({
        enrichment_enqueue: "failed",
        enrichment_enqueue_error: errorMessage(error),
      });
    }
  }

  await upsertBookIdentifiers(ctx.db, book);
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
      error: errorMessage(error),
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

  const validRecords = buzzes.data.records.filter(
    (record) => BuzzRecord.validateRecord(record.value).success,
  );

  const bookUris = validRecords.map((r) => (r.value as BuzzRecord.Record).book.uri);
  const bookRows =
    bookUris.length > 0
      ? await ctx.db
          .selectFrom("user_book")
          .select(["uri", "hiveId"])
          .where("uri", "in", bookUris)
          .execute()
      : [];
  const uriToHiveId = new Map(bookRows.map((r) => [r.uri, r.hiveId]));

  const buzzValues = [];

  for (const record of validRecords) {
    const book = record.value as BuzzRecord.Record;
    const hiveId = uriToHiveId.get(book.book.uri);

    if (!hiveId) {
      ctx.addWideEventContext({
        refetch_buzz_hive_id_missing: true,
        record_uri: record.uri,
      });
      continue;
    }

    uris.push(record.uri);
    buzzValues.push({
      uri: record.uri,
      cid: record.cid,
      userDid: agent.did,
      createdAt: book.createdAt,
      indexedAt: new Date().toISOString(),
      hiveId: hiveId,
      comment: book.comment ?? "",
      parentUri: book.parent.uri,
      parentCid: book.parent.cid,
      bookCid: book.book.cid,
      bookUri: book.book.uri,
    });
  }

  if (buzzValues.length > 0) {
    await ctx.db
      .insertInto("buzz")
      .values(buzzValues)
      .onConflict((oc) => oc.column("uri").doUpdateSet(buzzUpsertSet))
      .execute();
  }

  if (buzzes.data.records.length === 100) {
    await new Promise((r) => setTimeout(r, 100));
    return refetchBuzzes({ agent, ctx, cursor: buzzes.data?.cursor, uris });
  } else {
    await pruneMirroredRecords({ db: ctx.db, table: "buzz", userDid: agent.did, keepUris: uris });
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

  const indexedAt = new Date().toISOString();
  const rowsToUpsert = bookRecords.map((record) => {
    const book = record.value;

    // warmCatalogSearch owns the concurrency ceiling — it used to live at this
    // call site, so a second copy of this loop fired searches unbounded.
    promises.push(warmCatalogSearch(book.title, ctx));
    uris.push(record.uri);

    if (!book.hiveBookUri) {
      const rkey = record.uri.split("/").at(-1)!;
      booksNeedingHiveUri.push({ rkey, hiveId: book.hiveId as HiveId, record: book });
    }

    return serializeUserBook({
      uri: record.uri,
      cid: record.cid,
      userDid: agent.did,
      createdAt: book.createdAt,
      title: book.title,
      authors: book.authors,
      indexedAt,
      hiveId: book.hiveId as HiveId,
      status: book.status,
      owned: book.owned ? 1 : 0,
      startedAt: book.startedAt,
      finishedAt: book.finishedAt,
      review: book.review,
      stars: book.stars,
      bookProgress: book.bookProgress ?? null,
      previousReads: book.previousReads ?? null,
      record: book,
    });
  });

  for (let i = 0; i < rowsToUpsert.length; i += 100) {
    await ctx.db
      .insertInto("user_book")
      .values(rowsToUpsert.slice(i, i + 100))
      .onConflict((oc) => oc.column("uri").doUpdateSet(userBookUpsertSet))
      .execute();
  }

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
    await pruneMirroredRecords({
      db: ctx.db,
      table: "user_book",
      userDid: agent.did,
      keepUris: uris,
    });

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
        const batch = writes.slice(i, i + 200);
        const response = await agent.post("com.atproto.repo.applyWrites", {
          input: { repo: agent.did, writes: batch },
        });
        if (!response.ok) {
          throw new Error(
            `applyWrites hiveBookUri backfill failed: data=${JSON.stringify(response.data)}`,
          );
        }
        // Mirror what we wrote onto the rows — a stale cid costs the next edit
        // a CAS failure and a re-read.
        const results =
          (response.data as { results?: Array<{ uri?: string; cid?: string }> }).results ?? [];
        // One transaction to avoid per-row autocommit overhead.
        await ctx.db.transaction().execute(async (trx) => {
          for (const [index, write] of batch.entries()) {
            const result = results[index];
            if (!result?.uri || !result.cid) continue;
            await trx
              .updateTable("user_book")
              .set({ cid: result.cid, record: JSON.stringify(write.value) })
              .where("uri", "=", result.uri)
              .where("userDid", "=", agent.did)
              .execute();
          }
        });
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
