import { JetstreamSubscription } from "@atcute/jetstream";
import type { Storage } from "unstorage";
import type { Database } from "../db";
import { env } from "../env";
import { searchBooks } from "../routes/index";
import type { Buzz as BuzzRecord, HiveId, UserBook } from "../types";
import { serializeUserBook } from "../utils/bookProgress";
import { createActorResolver, createBidirectionalResolverAtcute } from "./id-resolver";
import { ids, Book, Buzz } from "./lexicon";

export type EmitWideEvent = (event: Record<string, unknown>) => void;

const WANTED_COLLECTIONS = [ids.BuzzBookhiveBook, ids.BuzzBookhiveBuzz];
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

    for (const collection of [ids.BuzzBookhiveBook, ids.BuzzBookhiveBuzz]) {
      let cursor: string | undefined;
      do {
        const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set("repo", did);
        url.searchParams.set("collection", collection);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);

        const res = await fetch(url);
        if (!res.ok) break;
        const data = (await res.json()) as {
          records: Array<{ uri: string; cid: string; value: unknown }>;
          cursor?: string;
        };

        const now = new Date();
        for (const record of data.records) {
          // Insert directly to avoid duplicate wide events
          if (collection === ids.BuzzBookhiveBook) {
            const asBook = Book.validateRecord(record.value);
            if (!asBook.success) continue;
            const book = asBook.value;
            const hiveId = (
              await db
                .selectFrom("hive_book")
                .select("id")
                .where("id", "=", (record.value as Record<string, unknown>)["hiveId"] as HiveId)
                .executeTakeFirst()
            )?.id;
            if (!hiveId) continue;
            await db
              .insertInto("user_book")
              .values(
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
                  review: book.review ?? null,
                  stars: book.stars ?? null,
                  bookProgress: book.bookProgress ?? null,
                } satisfies UserBook),
              )
              .onConflict((oc) => oc.column("uri").doNothing())
              .execute();
          } else if (collection === ids.BuzzBookhiveBuzz) {
            const asBuzz = Buzz.validateRecord(record.value);
            if (!asBuzz.success) continue;
            const buzz = asBuzz.value;
            const hiveId = (
              await db
                .selectFrom("user_book")
                .select("hiveId")
                .where("uri", "=", buzz.book.uri)
                .executeTakeFirst()
            )?.hiveId;
            if (!hiveId) continue;
            await db
              .insertInto("buzz")
              .values({
                uri: record.uri,
                cid: record.cid,
                userDid: did,
                hiveId,
                createdAt: buzz.createdAt,
                indexedAt: now.toISOString(),
                bookCid: buzz.book.cid,
                bookUri: buzz.book.uri,
                comment: buzz.comment,
                parentCid: buzz.parent.cid,
                parentUri: buzz.parent.uri,
              } satisfies BuzzRecord)
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

export function createIngester(db: Database, kv: Storage, emitWideEvent: EmitWideEvent): Ingester {
  const bidirectionalResolver = createBidirectionalResolverAtcute();
  const backfilledDids = new Set<string>();
  let subscription: JetstreamSubscription | null = null;
  let abortController: AbortController | null = null;

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
            void searchBooks({
              query: book.title,
              ctx: { db, kv, addWideEventContext: () => {} },
            });
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

          // Proactively backfill full repo for newly-discovered DIDs
          if (isNewDid) {
            backfilledDids.add(evt.did);
            void kv.get(BACKFILL_DONE_PREFIX + evt.did).then((done) => {
              if (!done) {
                void backfillUserRepo(evt.did, db, kv, emitWideEvent);
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
      wideEvent["duration_ms"] = Date.now() - start;
      emitWideEvent(wideEvent);
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
      if (err instanceof Error && err.name === "AbortError") return;
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
        void start();
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
          },
          timestamp: new Date().toISOString(),
          env: { node_env: env.NODE_ENV },
        });
      },
    });
    void run();
  }

  return {
    start: () => void start(),
    async destroy() {
      abortController?.abort();
      subscription = null;
      abortController = null;
    },
  };
}
