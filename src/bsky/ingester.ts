import { IdResolver } from "@atproto/identity";
import { Firehose } from "@atproto/sync";
import type { Database } from "../db";
import type { HiveId, UserBook, Buzz as BuzzRecord } from "../types";
import * as Book from "./lexicon/types/buzz/bookhive/book";
import * as Buzz from "./lexicon/types/buzz/bookhive/buzz";
import { ids } from "./lexicon/lexicons";
import { getLogger } from "../logger";
import { createBidirectionalResolver } from "./id-resolver";
import { searchBooks } from "../routes";
import type { Storage } from "unstorage";
const logger = getLogger({ name: "firehose-ingestion" });

export function createIngester(
  db: Database,
  idResolver: IdResolver,
  kv: Storage,
) {
  const bidirectionalResolver = createBidirectionalResolver(idResolver);
  return new Firehose({
    idResolver,
    handleEvent: async (evt) => {
      // Watch for write events
      if (evt.event === "create" || evt.event === "update") {
        const now = new Date();
        const record = evt.record;
        logger.debug("ingesting event", { evt });

        // If the write is a valid status update
        if (
          evt.collection === ids.BuzzBookhiveBook &&
          Book.isRecord(record) &&
          Book.validateRecord(record).success
        ) {
          logger.debug("valid book", { record });
          // Asynchronously fetch the user's handle
          bidirectionalResolver.resolveDidToHandle(evt.did);

          const hiveId = (
            await db
              .selectFrom("hive_book")
              .select("id")
              .where("id", "=", record.hiveId as HiveId)
              .executeTakeFirst()
          )?.id;
          if (!hiveId) {
            // Try to index the book into the hive, async
            searchBooks({ query: record.title, ctx: { db, kv } });
            logger.error("Trying to index book into hive", { record });
          }
          // Store the book in our SQLite
          await db
            .insertInto("user_book")
            .values({
              uri: evt.uri.toString(),
              cid: evt.cid.toString(),
              userDid: evt.did,
              hiveId: record.hiveId as HiveId,
              createdAt: record.createdAt,
              indexedAt: now.toISOString(),
              title: record.title,
              authors: record.authors,
              startedAt: record.startedAt ?? null,
              finishedAt: record.finishedAt ?? null,
              status: record.status ?? null,
              review: record.review ?? null,
              stars: record.stars ?? null,
            } satisfies UserBook)
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
              })),
            )
            .execute();
          return;
        } else if (
          evt.collection === ids.BuzzBookhiveBuzz &&
          Buzz.isRecord(record) &&
          Buzz.validateRecord(record).success
        ) {
          logger.debug("valid buzz", { record });
          // Asynchronously fetch the user's handle
          bidirectionalResolver.resolveDidToHandle(evt.did);

          const hiveId = (
            await db
              .selectFrom("user_book")
              .select("hiveId")
              .where("uri", "=", record.book.uri)
              .executeTakeFirst()
          )?.hiveId;

          if (!hiveId) {
            logger.error("hiveId not found for book", { record });
            return;
          }

          // Store the book in our SQLite
          await db
            .insertInto("buzz")
            .values({
              uri: evt.uri.toString(),
              cid: evt.cid.toString(),
              userDid: evt.did,
              hiveId,
              createdAt: record.createdAt,
              indexedAt: now.toISOString(),
              bookCid: record.book.cid,
              bookUri: record.book.uri,
              comment: record.comment,
              parentCid: record.parent.cid,
              parentUri: record.parent.uri,
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
      } else if (evt.event === "delete") {
        if (evt.collection === ids.BuzzBookhiveBook) {
          logger.debug("delete book", { evt });
          // Remove the status from our SQLite
          await db
            .deleteFrom("user_book")
            .where("uri", "=", evt.uri.toString())
            .execute();
          return;
        } else if (evt.collection === ids.BuzzBookhiveBuzz) {
          logger.debug("delete buzz", { evt });
          await db
            .deleteFrom("buzz")
            .where("uri", "=", evt.uri.toString())
            .execute();
          return;
        }
      }
    },
    onError: (err) => {
      logger.trace("error on firehose ingestion", { err });
    },
    filterCollections: [ids.BuzzBookhiveBook, ids.BuzzBookhiveBuzz],
    excludeIdentity: true,
    excludeAccount: true,
  });
}
