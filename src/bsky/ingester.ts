import { JetstreamSubscription } from "@atcute/jetstream";
import type { Storage } from "unstorage";
import type { Database } from "../db";
import { getLogger } from "../logger";
import { searchBooks } from "../routes/index";
import type { Buzz as BuzzRecord, HiveId, UserBook } from "../types";
import { serializeUserBook } from "../utils/bookProgress";
import { createBidirectionalResolverAtcute } from "./id-resolver";
import { ids, Book, Buzz } from "./lexicon";

const logger = getLogger({ name: "firehose-ingestion" });

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

export function createIngester(db: Database, kv: Storage): Ingester {
  const bidirectionalResolver = createBidirectionalResolverAtcute();
  let subscription: JetstreamSubscription | null = null;
  let abortController: AbortController | null = null;

  const handleEvent = async (evt: IngesterEvent) => {
    if (evt.event === "create" || evt.event === "update") {
      const now = new Date();
      const record = evt.record;
      logger.debug({ evt }, "ingesting event");

      if (evt.collection === ids.BuzzBookhiveBook) {
        const asBook = Book.validateRecord(record);
        if (!asBook.success) return;
        const book = asBook.value;
        logger.debug({ record }, "valid book");
        bidirectionalResolver.resolveDidToHandle(evt.did);

        const hiveId = (
          await db
            .selectFrom("hive_book")
            .select("id")
            .where(
              "id",
              "=",
              (record as Record<string, unknown>)["hiveId"] as HiveId,
            )
            .executeTakeFirst()
        )?.id;
        if (!hiveId) {
          searchBooks({ query: book.title, ctx: { db, kv, logger } });
          logger.error({ record }, "Trying to index book into hive");
        }
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
        return;
      }
      if (evt.collection === ids.BuzzBookhiveBuzz) {
        const asBuzz = Buzz.validateRecord(record);
        if (!asBuzz.success) return;
        const buzz = asBuzz.value;
        logger.debug({ record }, "valid buzz");
        bidirectionalResolver.resolveDidToHandle(evt.did);

        const hiveId = (
          await db
            .selectFrom("user_book")
            .select("hiveId")
            .where("uri", "=", buzz.book.uri)
            .executeTakeFirst()
        )?.hiveId;

        if (!hiveId) {
          logger.error({ record }, "hiveId not found for book");
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
        return;
      }
    }
    if (evt.event === "delete") {
      if (evt.collection === ids.BuzzBookhiveBook) {
        logger.debug({ evt }, "delete book");
        await db
          .deleteFrom("user_book")
          .where("uri", "=", evt.uri.toString())
          .execute();
        return;
      }
      if (evt.collection === ids.BuzzBookhiveBuzz) {
        logger.debug({ evt }, "delete buzz");
        await db
          .deleteFrom("buzz")
          .where("uri", "=", evt.uri.toString())
          .execute();
        return;
      }
    }
  };

  const run = async () => {
    if (!subscription) return;
    try {
      for await (const event of subscription) {
        if (event.kind !== "commit") continue;
        const evt = commitToEvent(event.did, event.commit);
        try {
          await handleEvent(evt);
        } catch (err) {
          logger.trace({ err }, "error on jetstream ingestion");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      logger.trace({ err }, "error on jetstream ingestion");
      setTimeout(() => {
        if (abortController?.signal.aborted) return;
        start();
      }, 3000);
    }
  };

  function start() {
    abortController = new AbortController();
    subscription = new JetstreamSubscription({
      url: JETSTREAM_URL,
      wantedCollections: WANTED_COLLECTIONS,
      onConnectionError(event) {
        logger.trace({ err: event.error }, "jetstream connection error");
      },
    });
    run();
  }

  return {
    start,
    async destroy() {
      abortController?.abort();
      subscription = null;
      abortController = null;
    },
  };
}
