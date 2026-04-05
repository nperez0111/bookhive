import { JetstreamSubscription } from "@atcute/jetstream";
import type { Storage } from "unstorage";
import type { Database } from "../db";
import { env } from "../env";
import {
  ingesterEventDuration,
  ingesterEventsTotal,
  ingesterBackfillActive,
  ingesterBackfillQueueDepth,
  labelKey,
} from "../metrics";
import { searchBooks } from "../routes/lib";
import type { Buzz as BuzzRecord, HiveId, UserBook } from "../types";
import { serializeUserBook } from "../utils/bookProgress";
import { writeCatalogBookIfNeeded } from "../utils/catalogBookService";
import type { SessionClient } from "../auth/client";
import {
  createActorResolver,
  createBidirectionalResolverAtcute,
  createCachingBidirectionalResolver,
} from "./id-resolver";
import { ids, Book, Buzz, List, ListItem } from "./lexicon";

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

const WANTED_COLLECTIONS = [
  ids.BuzzBookhiveBook,
  ids.BuzzBookhiveBuzz,
  ids.SocialPopfeedFeedList,
  ids.SocialPopfeedFeedListItem,
];
const JETSTREAM_URL = [
  "wss://jetstream1.us-east.bsky.network",
  "wss://jetstream2.us-east.bsky.network",
  "wss://jetstream1.us-west.bsky.network",
  "wss://jetstream2.us-west.bsky.network",
];

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
const JETSTREAM_CURSOR_KEY = "jetstream:cursor";

async function backfillUserRepo(
  did: string,
  db: Database,
  kv: Storage,
  emitWideEvent: EmitWideEvent,
): Promise<void> {
  try {
    const actor = await createActorResolver().resolve(
      did as Parameters<ReturnType<typeof createActorResolver>["resolve"]>[0],
    );
    const pds = actor.pds;

    for (const collection of [
      ids.BuzzBookhiveBook,
      ids.BuzzBookhiveBuzz,
      ids.SocialPopfeedFeedList,
      ids.SocialPopfeedFeedListItem,
    ]) {
      let cursor: string | undefined;
      do {
        const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set("repo", did);
        url.searchParams.set("collection", collection);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);

        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) break;
        const data = (await res.json()) as {
          records: Array<{ uri: string; cid: string; value: unknown }>;
          cursor?: string;
        };

        const now = new Date();
        if (collection === ids.BuzzBookhiveBook) {
          // Batch-validate records
          const validBooks = data.records.flatMap((record) => {
            const parsed = Book.validateRecord(record.value);
            return parsed.success ? [{ record, book: parsed.value }] : [];
          });

          if (validBooks.length > 0) {
            // Batch-fetch which hiveIds exist
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
        } else if (collection === ids.BuzzBookhiveBuzz) {
          // Batch-validate records
          const validBuzzes = data.records.flatMap((record) => {
            const parsed = Buzz.validateRecord(record.value);
            return parsed.success ? [{ record, buzz: parsed.value }] : [];
          });

          if (validBuzzes.length > 0) {
            // Batch-fetch hiveIds for all referenced book URIs
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
        } else if (collection === ids.SocialPopfeedFeedList) {
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
                name: list.name,
                description: list.description ?? null,
                ordered: list.ordered ? 1 : 0,
                tags: list.tags ? JSON.stringify(list.tags) : null,
                createdAt: list.createdAt,
                indexedAt: now.toISOString(),
              })
              .onConflict((oc) => oc.column("uri").doNothing())
              .execute();
          }
        } else if (collection === ids.SocialPopfeedFeedListItem) {
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
      error: { message: err instanceof Error ? err.message : String(err) },
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
  let subscription: JetstreamSubscription | null = null;
  let abortController: AbortController | null = null;
  let destroyed = false;

  // Concurrency limiter for backfill operations
  const BACKFILL_CONCURRENCY = 3;
  let activeBackfills = 0;
  const backfillQueue: Array<() => void> = [];

  function enqueueBackfill(did: string) {
    if (destroyed) return;
    const run = async () => {
      activeBackfills++;
      ingesterBackfillActive.set(activeBackfills);
      try {
        await backfillUserRepo(did, db, kv, emitWideEvent);
      } finally {
        activeBackfills--;
        ingesterBackfillActive.set(activeBackfills);
        const next = backfillQueue.shift();
        ingesterBackfillQueueDepth.set(backfillQueue.length);
        if (next) next();
      }
    };
    if (activeBackfills < BACKFILL_CONCURRENCY) {
      run().catch(() => {});
    } else {
      backfillQueue.push(() => {
        run().catch(() => {});
      });
      ingesterBackfillQueueDepth.set(backfillQueue.length);
    }
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
        error: { message: err instanceof Error ? err.message : String(err) },
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
              } satisfies UserBook),
            )
            .onConflict((oc) =>
              oc.column("uri").doUpdateSet((c) => ({
                indexedAt: c.ref("excluded.indexedAt"),
                cid: c.ref("excluded.cid"),
                hiveId: c.ref("excluded.hiveId"),
                status: c.ref("excluded.status"),
                owned: c.ref("excluded.owned"),
                review: c.ref("excluded.review"),
                stars: c.ref("excluded.stars"),
                startedAt: c.ref("excluded.startedAt"),
                finishedAt: c.ref("excluded.finishedAt"),
                title: c.ref("excluded.title"),
                authors: c.ref("excluded.authors"),
                userDid: c.ref("excluded.userDid"),
                createdAt: c.ref("excluded.createdAt"),
                bookProgress: c.ref("excluded.bookProgress"),
              })),
            )
            .execute();

          if (serviceAccountAgent) {
            tracked("writeCatalogBook", evt.did, () =>
              writeCatalogBookIfNeeded({ db, serviceAccountAgent }, hiveId),
            );
          }

          // Proactively backfill full repo for newly-discovered DIDs
          if (isNewDid) {
            backfilledDids.add(evt.did);
            void kv.get(BACKFILL_DONE_PREFIX + evt.did).then((done) => {
              if (!done) {
                enqueueBackfill(evt.did);
              }
            });
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
            .onConflict((oc) =>
              oc.column("uri").doUpdateSet((c) => ({
                uri: c.ref("excluded.uri"),
                cid: c.ref("excluded.cid"),
                userDid: c.ref("excluded.userDid"),
                hiveId: c.ref("excluded.hiveId"),
                indexedAt: c.ref("excluded.indexedAt"),
                bookCid: c.ref("excluded.bookCid"),
                bookUri: c.ref("excluded.bookUri"),
                comment: c.ref("excluded.comment"),
                parentCid: c.ref("excluded.parentCid"),
                parentUri: c.ref("excluded.parentUri"),
              })),
            )
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
              name: list.name,
              description: list.description ?? null,
              ordered: list.ordered ? 1 : 0,
              tags: list.tags ? JSON.stringify(list.tags) : null,
              createdAt: list.createdAt,
              indexedAt: now.toISOString(),
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

          // Only process book items
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
          // Delete list and all its items
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
        message: err instanceof Error ? err.message : String(err),
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

  const run = async () => {
    if (!subscription) return;
    try {
      for await (const event of subscription) {
        if (event.kind !== "commit") continue;
        const evt = commitToEvent(event.did, event.commit);
        await handleEvent(evt);
        // Persist cursor after each processed event
        void kv.set(JETSTREAM_CURSOR_KEY, String(event.time_us));
      }
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || abortController?.signal.aborted))
        return;
      emitWideEvent({
        msg: "ingester",
        outcome: "error",
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: err instanceof Error ? err.name : "Error",
        },
        timestamp: new Date().toISOString(),
        env: { node_env: env.NODE_ENV },
      });
      setTimeout(() => {
        if (abortController?.signal.aborted) return;
        start().catch(() => {});
      }, 3000);
    }
  };

  async function start() {
    abortController = new AbortController();
    const storedCursor = await kv.get<string>(JETSTREAM_CURSOR_KEY);
    const cursor = storedCursor ? Number(storedCursor) : undefined;
    subscription = new JetstreamSubscription({
      url: JETSTREAM_URL,
      wantedCollections: WANTED_COLLECTIONS,
      cursor,
      ws: {
        connectionTimeout: 20_000,
      },
      onConnectionError(event) {
        emitWideEvent({
          msg: "ingester",
          outcome: "connection_error",
          error: {
            message: event.error instanceof Error ? event.error.message : String(event.error),
            type: event.error instanceof Error ? event.error.name : "Error",
          },
          timestamp: new Date().toISOString(),
          env: { node_env: env.NODE_ENV },
        });
      },
    });
    run().catch((err) => {
      emitWideEvent({
        msg: "ingester",
        outcome: "error",
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: err instanceof Error ? err.name : "Error",
        },
        timestamp: new Date().toISOString(),
        env: { node_env: env.NODE_ENV },
      });
    });
  }

  return {
    start: () => void start().catch(() => {}),
    async destroy() {
      destroyed = true;
      abortController?.abort();
      backfillQueue.length = 0;
      subscription = null;
      abortController = null;
    },
  };
}
