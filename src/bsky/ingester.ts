import type { Storage } from "unstorage";
import {
  bookListItemUpsertSet,
  bookListUpsertSet,
  buzzUpsertSet,
  userBookUpsertSet,
  type Database,
  type DatabaseSchema,
} from "../db";
import { listRecordFields } from "../core/listRecord";
import { env } from "../env";
import {
  ingesterEventDuration,
  ingesterEventsTotal,
  ingesterBackfillActive,
  ingesterBackfillQueueDepth,
  labelKey,
} from "../metrics";
import { searchBooks } from "../services/searchBooks";
import type { Buzz as BuzzRecord, HiveId, UserBook } from "../types";
import { serializeUserBook } from "../core/bookProgress";
import { writeCatalogBookIfNeeded } from "../services/catalogBookService";
import { Semaphore } from "../lib/semaphore";
import type { SessionClient } from "../auth/client";
import {
  createActorResolver,
  createBidirectionalResolverAtcute,
  createCachingBidirectionalResolver,
} from "./id-resolver";
import { ids, Book, Buzz, List, ListItem } from "./lexicon";
import { errorMessage } from "../lib/errors";
import { startJetstream } from "./jetstream";

// Pre-compute label keys for ingester metrics to avoid JSON.stringify per event
const ingesterLabelCache = new Map<string, string>();
function getIngesterLabel(labels: Record<string, string>): string {
  const cacheKey = `${labels["collection"]}:${labels["event"] ?? labels["outcome"] ?? ""}`;
  let key = ingesterLabelCache.get(cacheKey);
  if (!key) {
    key = labelKey(labels);
    ingesterLabelCache.set(cacheKey, key);
  }
  return key;
}

export type EmitWideEvent = (event: Record<string, unknown>) => void;

type CollectionType =
  | typeof ids.BuzzBookhiveBook
  | typeof ids.BuzzBookhiveBuzz
  | typeof ids.SocialPopfeedFeedList
  | typeof ids.SocialPopfeedFeedListItem;

const COLLECTION_TABLES = {
  [ids.BuzzBookhiveBook]: "user_book",
  [ids.BuzzBookhiveBuzz]: "buzz",
  [ids.SocialPopfeedFeedList]: "book_list",
  [ids.SocialPopfeedFeedListItem]: "book_list_item",
} as const satisfies Record<CollectionType, keyof DatabaseSchema>;
const WANTED_COLLECTIONS = Object.keys(COLLECTION_TABLES);
// V2 sequence cursors are instance-specific: reconnect to this host, not a random pool.
const JETSTREAM_SERVICE = "wss://jetstream2.us-east.bsky.network";

export type IngesterEvent = {
  event: "create" | "update" | "delete";
  collection: string;
  record?: unknown;
  uri: { toString(): string };
  cid: { toString(): string };
  did: string;
};

function cidToString(cid: string | { $link: string } | undefined): string {
  if (cid == null) return "";
  return typeof cid === "string" ? cid : cid.$link;
}

function commitToEvent(
  did: string,
  commit: {
    collection: string;
    operation: string;
    rkey: string;
    record?: unknown;
    cid?: string | { $link: string };
  },
): IngesterEvent {
  const uriStr = `at://${did}/${commit.collection}/${commit.rkey}`;
  return {
    event: commit.operation as "create" | "update" | "delete",
    collection: commit.collection,
    record: commit.record,
    uri: { toString: () => uriStr },
    cid: { toString: () => cidToString(commit.cid) },
    did,
  };
}

export type Ingester = {
  start(): void;
  destroy(): Promise<void>;
};

const BACKFILL_DONE_PREFIX = "backfill_done:";

export async function backfillUserRepo(
  did: string,
  db: Database,
  kv: Storage,
  emitWideEvent: EmitWideEvent,
  resolvePds = async (did: string) =>
    (
      await createActorResolver().resolve(
        did as Parameters<ReturnType<typeof createActorResolver>["resolve"]>[0],
      )
    ).pds,
  fetchRecords: (url: URL, init: RequestInit) => Promise<Response> = fetch,
): Promise<void> {
  try {
    const pds = await resolvePds(did);

    for (const [collection, table] of Object.entries(COLLECTION_TABLES)) {
      let cursor: string | undefined;
      let pages = 0;
      do {
        if (++pages > 500) throw new Error(`Backfill page limit reached: ${collection}`);
        const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set("repo", did);
        url.searchParams.set("collection", collection);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);

        const res = await fetchRecords(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`listRecords ${collection}: HTTP ${res.status}`);
        const data = (await res.json()) as {
          records: Array<{ uri: string; cid: string; value: unknown }>;
          cursor?: string;
        };

        if (!Array.isArray(data.records) || (data.cursor && data.cursor === cursor)) {
          throw new Error(`Invalid listRecords page: ${collection}`);
        }
        data.records = data.records.filter((record) =>
          record.uri.startsWith(`at://${did}/${collection}/`),
        );
        const now = new Date();
        if (table === "user_book") {
          const validBooks = data.records.flatMap((record) => {
            const parsed = Book.validateRecord(record.value);
            return parsed.success ? [{ record, book: parsed.value }] : [];
          });

          if (validBooks.length > 0) {
            const requestedHiveIds = validBooks.map((r) => r.book.hiveId as HiveId);
            const existingBooks = await db
              .selectFrom("hive_book")
              .select("id")
              .where("id", "in", requestedHiveIds)
              .execute();
            const existingHiveIds = new Set(existingBooks.map((b) => b.id));

            const rowsToInsert = validBooks
              .filter(({ book }) => existingHiveIds.has(book.hiveId as HiveId))
              .map(({ record, book }) =>
                serializeUserBook({
                  uri: record.uri,
                  cid: record.cid,
                  userDid: did,
                  hiveId: book.hiveId as HiveId,
                  createdAt: book.createdAt,
                  indexedAt: now.toISOString(),
                  title: book.title,
                  authors: book.authors,
                  startedAt: book.startedAt ?? null,
                  finishedAt: book.finishedAt ?? null,
                  status: book.status ?? null,
                  owned: book.owned ? 1 : 0,
                  review: book.review ?? null,
                  stars: book.stars ?? null,
                  bookProgress: book.bookProgress ?? null,
                  previousReads: book.previousReads ?? null,
                  record: book,
                } satisfies UserBook),
              );
            for (let i = 0; i < rowsToInsert.length; i += 100) {
              await db
                .insertInto("user_book")
                .values(rowsToInsert.slice(i, i + 100))
                .onConflict((oc) => oc.column("uri").doNothing())
                .execute();
            }
          }
        } else if (table === "buzz") {
          const validBuzzes = data.records.flatMap((record) => {
            const parsed = Buzz.validateRecord(record.value);
            return parsed.success ? [{ record, buzz: parsed.value }] : [];
          });

          if (validBuzzes.length > 0) {
            const bookUris = validBuzzes.map((r) => r.buzz.book.uri);
            const bookRows = await db
              .selectFrom("user_book")
              .select(["uri", "hiveId"])
              .where("uri", "in", bookUris)
              .execute();
            const uriToHiveId = new Map(bookRows.map((r) => [r.uri, r.hiveId]));

            const buzzRows = validBuzzes
              .filter(({ buzz }) => uriToHiveId.has(buzz.book.uri))
              .map(
                ({ record, buzz }) =>
                  ({
                    uri: record.uri,
                    cid: record.cid,
                    userDid: did,
                    hiveId: uriToHiveId.get(buzz.book.uri)!,
                    createdAt: buzz.createdAt,
                    indexedAt: now.toISOString(),
                    bookCid: buzz.book.cid,
                    bookUri: buzz.book.uri,
                    comment: buzz.comment,
                    parentCid: buzz.parent.cid,
                    parentUri: buzz.parent.uri,
                  }) satisfies BuzzRecord,
              );
            for (let i = 0; i < buzzRows.length; i += 100) {
              await db
                .insertInto("buzz")
                .values(buzzRows.slice(i, i + 100))
                .onConflict((oc) => oc.column("uri").doNothing())
                .execute();
            }
          }
        } else if (table === "book_list") {
          for (const record of data.records) {
            const asList = List.validateRecord(record.value);
            if (!asList.success) continue;
            const list = asList.value;
            await db
              .insertInto("book_list")
              .values({
                uri: record.uri,
                cid: record.cid,
                userDid: did,
                ...listRecordFields(list),
                indexedAt: now.toISOString(),
              })
              .onConflict((oc) => oc.column("uri").doUpdateSet(bookListUpsertSet))
              .execute();
          }
        } else if (table === "book_list_item") {
          for (const record of data.records) {
            const asItem = ListItem.validateRecord(record.value);
            if (!asItem.success) continue;
            const item = asItem.value;
            if (item.creativeWorkType !== "book") continue;

            let hiveId: HiveId | null = (item.identifiers?.hiveId as HiveId) ?? null;
            if (!hiveId && (item.identifiers?.isbn13 || item.identifiers?.isbn10)) {
              const idRow = await db
                .selectFrom("book_id_map")
                .select("hiveId")
                .where((eb) =>
                  eb.or([
                    ...(item.identifiers?.isbn13
                      ? [eb("isbn13", "=", item.identifiers.isbn13)]
                      : []),
                    ...(item.identifiers?.isbn10 ? [eb("isbn", "=", item.identifiers.isbn10)] : []),
                  ]),
                )
                .executeTakeFirst();
              if (idRow) hiveId = idRow.hiveId;
            }
            await db
              .insertInto("book_list_item")
              .values({
                uri: record.uri,
                cid: record.cid,
                userDid: did,
                listUri: item.listUri,
                hiveId,
                description: item.description ?? null,
                position: item.position ?? null,
                addedAt: item.addedAt,
                indexedAt: now.toISOString(),
                embeddedTitle: item.title ?? null,
                embeddedAuthor: item.mainCredit ?? null,
                embeddedCoverUrl: item.posterUrl ?? null,
                identifiers: item.identifiers ? JSON.stringify(item.identifiers) : null,
              })
              .onConflict((oc) => oc.column("uri").doNothing())
              .execute();
          }
        }

        cursor = data.cursor;
        if (cursor) await new Promise((r) => setTimeout(r, 100));
      } while (cursor);
    }

    await kv.set(BACKFILL_DONE_PREFIX + did, "1");
    emitWideEvent({
      msg: "ingester",
      outcome: "backfill_complete",
      did,
      timestamp: new Date().toISOString(),
      env: { node_env: env.NODE_ENV },
    });
  } catch (err) {
    emitWideEvent({
      msg: "ingester",
      outcome: "backfill_error",
      did,
      error: { message: errorMessage(err) },
      timestamp: new Date().toISOString(),
      env: { node_env: env.NODE_ENV },
    });
  }
}

export function createIngester(
  db: Database,
  kv: Storage,
  serviceAccountAgent: SessionClient | null,
  emitWideEvent: EmitWideEvent,
): Ingester {
  const bidirectionalResolver = createCachingBidirectionalResolver(
    kv,
    createBidirectionalResolverAtcute(),
  );
  const backfilledDids = new Set<string>();
  let stopStream: (() => Promise<void>) | undefined;
  let destroyed = false;

  const BACKFILL_CONCURRENCY = 3;
  const backfillSemaphore = new Semaphore(BACKFILL_CONCURRENCY, {
    label: "ingester_backfill",
    onChange: ({ active, pending }) => {
      ingesterBackfillActive.set(active);
      ingesterBackfillQueueDepth.set(pending);
    },
  });

  async function enqueueBackfill(did: string) {
    if (destroyed || (await kv.get(BACKFILL_DONE_PREFIX + did))) return;
    await backfillSemaphore.run(() => backfillUserRepo(did, db, kv, emitWideEvent));
  }

  // Log errors from fire-and-forget background operations
  function tracked(name: string, did: string, fn: () => Promise<unknown>): void {
    if (destroyed) return;
    fn().catch((err) => {
      emitWideEvent({
        msg: "ingester_bg",
        op: name,
        did,
        outcome: "error",
        error: { message: errorMessage(err) },
        timestamp: new Date().toISOString(),
      });
    });
  }

  const handleEvent = async (evt: IngesterEvent) => {
    const start = Date.now();
    const wideEvent: Record<string, unknown> = {
      msg: "ingester",
      collection: evt.collection,
      event: evt.event,
      did: evt.did,
      uri: evt.uri.toString(),
      timestamp: new Date().toISOString(),
      env: { node_env: env.NODE_ENV },
    };

    try {
      if (evt.event === "create" || evt.event === "update") {
        const now = new Date();
        const record = evt.record;

        if (evt.collection === ids.BuzzBookhiveBook) {
          const asBook = Book.validateRecord(record);
          if (!asBook.success) {
            wideEvent["outcome"] = "skipped";
            wideEvent["reason"] = "invalid_record";
            return;
          }
          const book = asBook.value;
          void bidirectionalResolver.resolveDidToHandle(evt.did);

          const hiveId = (
            await db
              .selectFrom("hive_book")
              .select("id")
              .where("id", "=", (record as Record<string, unknown>)["hiveId"] as HiveId)
              .executeTakeFirst()
          )?.id;
          if (!hiveId) {
            tracked("searchBooks", evt.did, () =>
              searchBooks({
                query: book.title,
                ctx: { db, kv, addWideEventContext: () => {} },
              }),
            );
            wideEvent["outcome"] = "error";
            wideEvent["error"] = {
              message: "hiveId not found, triggered search",
              record_uri: evt.uri.toString(),
            };
            return;
          }
          const isNewDid = !backfilledDids.has(evt.did);
          await db
            .insertInto("user_book")
            .values(
              serializeUserBook({
                uri: evt.uri.toString(),
                cid: evt.cid.toString(),
                userDid: evt.did,
                hiveId: book.hiveId as HiveId,
                createdAt: book.createdAt,
                indexedAt: now.toISOString(),
                title: book.title,
                authors: book.authors,
                startedAt: book.startedAt ?? null,
                finishedAt: book.finishedAt ?? null,
                status: book.status ?? null,
                owned: book.owned ? 1 : 0,
                review: book.review ?? null,
                stars: book.stars ?? null,
                bookProgress: book.bookProgress ?? null,
                previousReads: book.previousReads ?? null,
                record: book,
              } satisfies UserBook),
            )
            .onConflict((oc) => oc.column("uri").doUpdateSet(userBookUpsertSet))
            .execute();

          if (serviceAccountAgent) {
            tracked("writeCatalogBook", evt.did, () =>
              writeCatalogBookIfNeeded({ db, serviceAccountAgent }, hiveId),
            );
          }

          // Proactively backfill full repo for newly-discovered DIDs
          if (isNewDid) {
            backfilledDids.add(evt.did);
            tracked("backfill", evt.did, () => enqueueBackfill(evt.did));
          }

          wideEvent["outcome"] = "success";
          return;
        }
        if (evt.collection === ids.BuzzBookhiveBuzz) {
          const asBuzz = Buzz.validateRecord(record);
          if (!asBuzz.success) {
            wideEvent["outcome"] = "skipped";
            wideEvent["reason"] = "invalid_record";
            return;
          }
          const buzz = asBuzz.value;
          void bidirectionalResolver.resolveDidToHandle(evt.did);

          const hiveId = (
            await db
              .selectFrom("user_book")
              .select("hiveId")
              .where("uri", "=", buzz.book.uri)
              .executeTakeFirst()
          )?.hiveId;

          if (!hiveId) {
            wideEvent["outcome"] = "error";
            wideEvent["error"] = {
              message: "hiveId not found for book",
              book_uri: buzz.book.uri,
            };
            return;
          }

          await db
            .insertInto("buzz")
            .values({
              uri: evt.uri.toString(),
              cid: evt.cid.toString(),
              userDid: evt.did,
              hiveId,
              createdAt: buzz.createdAt,
              indexedAt: now.toISOString(),
              bookCid: buzz.book.cid,
              bookUri: buzz.book.uri,
              comment: buzz.comment,
              parentCid: buzz.parent.cid,
              parentUri: buzz.parent.uri,
            } satisfies BuzzRecord)
            .onConflict((oc) => oc.column("uri").doUpdateSet(buzzUpsertSet))
            .execute();
          wideEvent["outcome"] = "success";
          return;
        }
        if (evt.collection === ids.SocialPopfeedFeedList) {
          const asList = List.validateRecord(record);
          if (!asList.success) {
            wideEvent["outcome"] = "skipped";
            wideEvent["reason"] = "invalid_record";
            return;
          }
          const list = asList.value;
          void bidirectionalResolver.resolveDidToHandle(evt.did);

          // Only store lists from users with BookHive activity
          const hasBookhiveActivity = await db
            .selectFrom("user_book")
            .select(db.fn.count<number>("uri").as("count"))
            .where("userDid", "=", evt.did)
            .executeTakeFirst();
          if (!hasBookhiveActivity?.count) {
            wideEvent["outcome"] = "skipped";
            wideEvent["reason"] = "no_bookhive_activity";
            return;
          }

          await db
            .insertInto("book_list")
            .values({
              uri: evt.uri.toString(),
              cid: evt.cid.toString(),
              userDid: evt.did,
              ...listRecordFields(list),
              indexedAt: now.toISOString(),
            })
            .onConflict((oc) => oc.column("uri").doUpdateSet(bookListUpsertSet))
            .execute();
          wideEvent["outcome"] = "success";
          return;
        }
        if (evt.collection === ids.SocialPopfeedFeedListItem) {
          const asItem = ListItem.validateRecord(record);
          if (!asItem.success) {
            wideEvent["outcome"] = "skipped";
            wideEvent["reason"] = "invalid_record";
            return;
          }
          const item = asItem.value;

          if (item.creativeWorkType !== "book") {
            wideEvent["outcome"] = "skipped";
            wideEvent["reason"] = "non_book_item";
            return;
          }

          void bidirectionalResolver.resolveDidToHandle(evt.did);

          // Resolve hiveId: check identifiers.hiveId first, then fall back to ISBN
          let hiveId: HiveId | null = (item.identifiers?.hiveId as HiveId) ?? null;

          if (!hiveId && (item.identifiers?.isbn13 || item.identifiers?.isbn10)) {
            const idRow = await db
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

          await db
            .insertInto("book_list_item")
            .values({
              uri: evt.uri.toString(),
              cid: evt.cid.toString(),
              userDid: evt.did,
              listUri: item.listUri,
              hiveId,
              description: item.description ?? null,
              position: item.position ?? null,
              addedAt: item.addedAt,
              indexedAt: now.toISOString(),
              embeddedTitle: item.title ?? null,
              embeddedAuthor: item.mainCredit ?? null,
              embeddedCoverUrl: item.posterUrl ?? null,
              identifiers: item.identifiers ? JSON.stringify(item.identifiers) : null,
            })
            .onConflict((oc) => oc.column("uri").doUpdateSet(bookListItemUpsertSet))
            .execute();
          wideEvent["outcome"] = hiveId ? "success" : "success_unresolved";
          return;
        }
      }
      if (evt.event === "delete") {
        if (evt.collection === ids.BuzzBookhiveBook) {
          await db.deleteFrom("user_book").where("uri", "=", evt.uri.toString()).execute();
          wideEvent["outcome"] = "success";
          return;
        }
        if (evt.collection === ids.BuzzBookhiveBuzz) {
          await db.deleteFrom("buzz").where("uri", "=", evt.uri.toString()).execute();
          wideEvent["outcome"] = "success";
          return;
        }
        if (evt.collection === ids.SocialPopfeedFeedList) {
          await db.deleteFrom("book_list_item").where("listUri", "=", evt.uri.toString()).execute();
          await db.deleteFrom("book_list").where("uri", "=", evt.uri.toString()).execute();
          wideEvent["outcome"] = "success";
          return;
        }
        if (evt.collection === ids.SocialPopfeedFeedListItem) {
          await db.deleteFrom("book_list_item").where("uri", "=", evt.uri.toString()).execute();
          wideEvent["outcome"] = "success";
          return;
        }
      }
      wideEvent["outcome"] = "skipped";
      wideEvent["reason"] = "unhandled";
    } catch (err) {
      wideEvent["outcome"] = "error";
      wideEvent["error"] = {
        message: errorMessage(err),
        type: err instanceof Error ? err.name : "Error",
      };
    } finally {
      const durationMs = Date.now() - start;
      wideEvent["duration_ms"] = durationMs;
      emitWideEvent(wideEvent);
      ingesterEventDuration.observe(
        durationMs / 1000,
        getIngesterLabel({ collection: evt.collection, event: evt.event }),
      );
      const outcome = typeof wideEvent["outcome"] === "string" ? wideEvent["outcome"] : "unknown";
      ingesterEventsTotal.inc(getIngesterLabel({ collection: evt.collection, outcome }));
    }
  };

  return {
    start() {
      if (destroyed || stopStream) return;
      stopStream = startJetstream({
        kv,
        options: {
          service: JETSTREAM_SERVICE,
          collections: WANTED_COLLECTIONS,
          ws: { connectionTimeout: 20_000 },
        },
        handleEvent: async (event) => {
          await handleEvent(commitToEvent(event.did, event));
        },
        emit: emitWideEvent,
      });
    },
    async destroy() {
      destroyed = true;
      backfillSemaphore.clearPending("ingester destroyed");
      await stopStream?.();
    },
  };
}
