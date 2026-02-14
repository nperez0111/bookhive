/**
 * Shared route helpers: search, refetch, sync, ensure book identifiers.
 * Used by main router, import routes, and xrpc.
 */
import type { SessionClient } from "../auth/client";
import type { AppContext } from "../context";
import { ids, Book as BookRecord, Buzz as BuzzRecord } from "../bsky/lexicon";
import type { HiveBook, HiveId } from "../types";
import { syncUserFollows, shouldSyncFollows } from "../utils/getFollows";
import { readThroughCache } from "../utils/readThroughCache";
import { findBookDetails } from "../scrapers";
import { enrichBookWithDetailedData } from "../utils/enrichBookData";
import { serializeUserBook } from "../utils/bookProgress";
import {
  upsertBookIdentifiers,
  upsertBookIdentifiersBatch,
} from "../utils/bookIdentifiers";

export async function searchBooks({
  query,
  ctx,
}: {
  query: string;
  ctx: Pick<AppContext, "db" | "kv" | "logger">;
}) {
  return await readThroughCache<HiveId[]>(
    ctx.kv,
    `search:${query}`,
    () =>
      findBookDetails(query).then(async (res) => {
        if (!res.success) {
          return [];
        }

        const bookIds = await ctx.db
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
          .then(() => {
            return res.data.map((book) => book.id);
          });

        try {
          await upsertBookIdentifiersBatch(ctx.db, res.data);
        } catch (error) {
          ctx.logger.warn(
            {
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to persist book id mappings during search",
          );
        }

        const enrichmentPromises = res.data.map((book) =>
          enrichBookWithDetailedData(book, ctx as AppContext).catch((error) => {
            ctx.logger.error(
              {
                bookId: book.id,
                error: error instanceof Error ? error.message : String(error),
              },
              "Background enrichment failed",
            );
          }),
        );

        Promise.allSettled(enrichmentPromises);

        return bookIds;
      }),
    [] as HiveId[],
    {
      requestsPerSecond: 5,
    },
  );
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
      ctx.logger.info(
        { userDid: agent.did },
        "Follows sync completed on login",
      );
    }
  } catch (error) {
    ctx.logger.warn(
      { userDid: agent.did, error },
      "Failed to sync follows on login",
    );
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
        ctx.logger.error({ record }, "hiveId not found for book");
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
    await ctx.db
      .deleteFrom("buzz")
      .where("userDid", "=", agent.did)
      .where("uri", "not in", uris)
      .execute();
  }
}

export async function refetchBooks({
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
      duplicatesByHiveId.set(hiveId, [
        ...duplicatesByHiveId.get(hiveId)!,
        record,
      ]);
    }
  });

  const promises: Promise<unknown>[] = [];

  Array.from(duplicatesByHiveId.values()).forEach((records) => {
    if (records.length > 1) {
      ctx.logger.info({ records }, "Duplicate book found");
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
    });
  } else {
    await ctx.db
      .deleteFrom("user_book")
      .where("userDid", "=", agent.did)
      .where("uri", "not in", uris)
      .execute();
  }
}
