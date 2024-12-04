import pino from "pino";
import { IdResolver } from "@atproto/identity";
import { Firehose } from "@atproto/sync";
import type { Database, HiveId } from "../db";
import * as Book from "./lexicon/types/buzz/bookhive/book";
import * as Buzz from "./lexicon/types/buzz/bookhive/buzz";
import { ids } from "./lexicon/lexicons";

export function createIngester(db: Database, idResolver: IdResolver) {
  const logger = pino({ name: "firehose ingestion" });
  return new Firehose({
    idResolver,
    handleEvent: async (evt) => {
      // Watch for write events
      if (evt.event === "create" || evt.event === "update") {
        const now = new Date();
        const record = evt.record;
        logger.info({ evt }, "ingesting event");

        // If the write is a valid status update
        if (
          evt.collection === ids.BuzzBookhiveBook &&
          Book.isRecord(record) &&
          Book.validateRecord(record).success
        ) {
          // Store the book in our SQLite
          await db
            .insertInto("user_book")
            .values({
              uri: evt.uri.toString(),
              cid: evt.cid.toString(),
              authorDid: evt.did,
              hiveId: record.hiveId as HiveId,
              createdAt: record.createdAt,
              indexedAt: now.toISOString(),
              startedAt: record.startedAt,
              finishedAt: record.finishedAt,
              status: record.status,
              title: record.title,
              authors: record.authors,
            })
            .onConflict((oc) =>
              oc.column("uri").doUpdateSet({
                indexedAt: now.toISOString(),
                hiveId: record.hiveId as HiveId,
                status: record.status,
                startedAt: record.startedAt,
                finishedAt: record.finishedAt,
              }),
            )
            .execute();
          return;
        } else if (
          evt.collection === ids.BuzzBookhiveBuzz &&
          Buzz.isRecord(record) &&
          Buzz.validateRecord(record).success
        ) {
          // Store the book review in our SQLite
          await db
            .insertInto("buzz")
            .values({
              uri: evt.uri.toString(),
              cid: evt.cid.toString(),
              authorDid: evt.did,
              createdAt: record.createdAt,
              indexedAt: now.toISOString(),
              bookUri: record.book.uri,
              bookCid: record.book.cid,
              commentUri: record.comment?.uri,
              commentCid: record.comment?.cid,
              stars: record.stars,
            })
            .onConflict((oc) =>
              oc.column("uri").doUpdateSet({
                indexedAt: now.toISOString(),
                bookUri: record.book.uri,
                commentUri: record.comment?.uri,
                stars: record.stars,
              }),
            )
            .execute();
          return;
        }
      } else if (evt.event === "delete") {
        if (evt.collection === ids.BuzzBookhiveBook) {
          // Remove the status from our SQLite
          await db
            .deleteFrom("user_book")
            .where("uri", "=", evt.uri.toString())
            .execute();
          return;
        } else if (evt.collection === ids.BuzzBookhiveBuzz) {
          // Remove the status from our SQLite
          await db
            .deleteFrom("buzz")
            .where("uri", "=", evt.uri.toString())
            .execute();
          return;
        }
      }
    },
    onError: (err) => {
      logger.trace({ err }, "error on firehose ingestion");
    },
    filterCollections: [ids.BuzzBookhiveBook, ids.BuzzBookhiveBuzz],
    excludeIdentity: true,
    excludeAccount: true,
  });
}
