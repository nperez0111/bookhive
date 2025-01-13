import { IdResolver } from "@atproto/identity";
import { Firehose } from "@atproto/sync";
import type { Database, HiveId } from "../db";
import * as Book from "./lexicon/types/buzz/bookhive/book";
import * as Buzz from "./lexicon/types/buzz/bookhive/buzz";
import { ids } from "./lexicon/lexicons";
import { getLogger } from "../logger";
import { createBidirectionalResolver } from "./id-resolver";

const logger = getLogger({ name: "firehose-ingestion" });

export function createIngester(db: Database, idResolver: IdResolver) {
  const bidirectionalResolver = createBidirectionalResolver(idResolver);
  return new Firehose({
    idResolver,
    handleEvent: async (evt) => {
      // Watch for write events
      if (evt.event === "create" || evt.event === "update") {
        const now = new Date();
        const record = evt.record;
        logger.trace("ingesting event", { evt });

        // If the write is a valid status update
        if (
          evt.collection === ids.BuzzBookhiveBook &&
          Book.isRecord(record) &&
          Book.validateRecord(record).success
        ) {
          logger.debug("valid book", { record });
          // Asynchronously fetch the user's handle
          bidirectionalResolver.resolveDidToHandle(evt.did);
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
              startedAt: record.startedAt,
              finishedAt: record.finishedAt,
              status: record.status,
              title: record.title,
              authors: record.authors,
            })
            .onConflict((oc) =>
              oc.column("uri").doUpdateSet({
                indexedAt: now.toISOString(),
                cid: evt.cid.toString(),
                hiveId: record.hiveId as HiveId,
                status: record.status,
                review: record.review,
                stars: record.stars,
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
            })
            .onConflict((oc) =>
              oc.column("uri").doUpdateSet({
                uri: evt.uri.toString(),
                cid: evt.cid.toString(),
                userDid: evt.did,
                hiveId,
                indexedAt: now.toISOString(),
                bookCid: record.book.cid,
                bookUri: record.book.uri,
                comment: record.comment,
                parentCid: record.parent.cid,
                parentUri: record.parent.uri,
              }),
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
