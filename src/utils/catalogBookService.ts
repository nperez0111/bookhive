import { Client, CredentialManager } from "@atcute/client";
import type { ActorIdentifier } from "@atcute/lexicons/syntax";
import type { Logger } from "pino";
import type { SessionClient } from "../auth/client";
import type { AppContext } from "../context";
import { createActorResolver } from "../bsky/id-resolver";
import { ids } from "../bsky/lexicon/ids";
import type { BlobRef, HiveBook, HiveId } from "../types";
import { uploadImageBlob } from "./uploadImageBlob";

export async function createServiceAccountAgent(
  handle: string,
  appPassword: string,
): Promise<SessionClient | null> {
  if (!handle || !appPassword) return null;
  try {
    const actor = await createActorResolver().resolve(handle as ActorIdentifier);
    const manager = new CredentialManager({ service: actor.pds });
    await manager.login({ identifier: handle, password: appPassword });
    const client = new Client({ handler: manager });
    return {
      get did() {
        if (!manager.session?.did) {
          throw new Error("[catalogBookService] No active session on service account agent");
        }
        return manager.session.did;
      },
      get: client.get.bind(client) as SessionClient["get"],
      post: client.post.bind(client) as SessionClient["post"],
    };
  } catch (err) {
    console.error("[catalogBookService] Failed to create service account agent:", err);
    return null;
  }
}

type CatalogCtx = Pick<AppContext, "db"> & {
  serviceAccountAgent: AppContext["serviceAccountAgent"] | undefined;
  logger?: Logger;
};

interface CatalogBlobs {
  thumbnailBlob?: BlobRef;
  coverBlob?: BlobRef;
}

function safeJsonParse<T>(json: string, fallback: T, context: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    console.warn(`[catalogBookService] JSON.parse failed for ${context}:`, json);
    return fallback;
  }
}

function buildCatalogBookValue(book: HiveBook, blobs?: CatalogBlobs) {
  return {
    $type: ids.BuzzBookhiveCatalogBook,
    id: book.id,
    title: book.title,
    authors: book.authors,
    thumbnail: book.thumbnail,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    ...(blobs?.thumbnailBlob ? { thumbnailBlob: blobs.thumbnailBlob } : {}),
    ...(book.description ? { description: book.description.slice(0, 5000) } : {}),
    ...(book.cover ? { cover: book.cover } : {}),
    ...(blobs?.coverBlob ? { coverBlob: blobs.coverBlob } : {}),
    ...(book.source ? { source: book.source } : {}),
    ...(book.sourceUrl ? { sourceUrl: book.sourceUrl } : {}),
    ...(book.sourceId ? { sourceId: book.sourceId } : {}),
    ...(book.rating !== null && book.rating !== undefined
      ? { rating: Math.round(book.rating) }
      : {}),
    ...(book.ratingsCount !== null && book.ratingsCount !== undefined
      ? { ratingsCount: book.ratingsCount }
      : {}),
    ...(book.genres
      ? { genres: safeJsonParse<string[]>(book.genres, [], `book ${book.id} genres`) }
      : {}),
    ...(book.series ? { series: book.series } : {}),
    ...(book.identifiers
      ? {
          identifiers: safeJsonParse<Record<string, string>>(
            book.identifiers,
            {},
            `book ${book.id} identifiers`,
          ),
        }
      : {}),
  };
}

/**
 * Upserts a single book to the @bookhive.buzz ATProto repo as a catalogBook record.
 * Skips if not yet enriched, or if already synced and updatedAt hasn't changed since.
 * Safe to call fire-and-forget.
 */
export async function writeCatalogBookIfNeeded(ctx: CatalogCtx, bookId: HiveId): Promise<void> {
  if (!ctx.serviceAccountAgent) return;

  // Fetch the full book fresh from DB to avoid races where enrichment runs
  // between when the caller triggered this and when we actually write the record.
  // Also gates on enrichedAt so we never write a partial record.
  const freshBook = await ctx.db
    .selectFrom("hive_book")
    .selectAll()
    .where("id", "=", bookId)
    .where("enrichedAt", "is not", null)
    .where((eb) =>
      eb.or([
        eb("hiveBookAtUri", "is", null),
        eb("hiveBookCatalogUpdatedAt", "is", null),
        eb(eb.ref("hiveBookCatalogUpdatedAt"), "<", eb.ref("updatedAt")),
      ]),
    )
    .executeTakeFirst();

  if (!freshBook) return;

  const agent = ctx.serviceAccountAgent;

  const [thumbnailBlob, coverBlob] = await Promise.all([
    uploadImageBlob(freshBook.thumbnail, agent),
    uploadImageBlob(freshBook.cover, agent),
  ]);

  const response = await agent.post("com.atproto.repo.putRecord", {
    input: {
      repo: agent.did,
      collection: ids.BuzzBookhiveCatalogBook,
      rkey: freshBook.id,
      record: buildCatalogBookValue(freshBook, { thumbnailBlob, coverBlob }),
    },
  });

  if (!response.ok) return;

  const uri = (response.data as { uri: string }).uri;
  if (!uri) return;

  await ctx.db
    .updateTable("hive_book")
    .set({ hiveBookAtUri: uri, hiveBookCatalogUpdatedAt: freshBook.updatedAt })
    .where("id", "=", freshBook.id)
    .execute();
}

/**
 * Writes a batch of books to @bookhive.buzz using individual putRecord calls.
 * putRecord is idempotent (create-or-update), so this is safe to retry if the
 * process crashes between the ATProto write and the local DB update.
 */
export async function writeCatalogBooksBatch(ctx: CatalogCtx, books: HiveBook[]): Promise<void> {
  if (!ctx.serviceAccountAgent || books.length === 0) return;

  const agent = ctx.serviceAccountAgent;

  // Upload blobs for all books in parallel
  const blobResults = await Promise.all(
    books.map(async (book) => {
      const [thumbnailBlob, coverBlob] = await Promise.all([
        uploadImageBlob(book.thumbnail, agent),
        uploadImageBlob(book.cover, agent),
      ]);
      return { thumbnailBlob, coverBlob };
    }),
  );
  const blobMap = new Map(books.map((book, i) => [book.id, blobResults[i]!]));

  // Use putRecord (idempotent) for each book, limited to 5 concurrent to avoid rate limits
  const CONCURRENCY = 5;
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    await Promise.all(
      books.slice(i, i + CONCURRENCY).map(async (book) => {
        const response = await agent.post("com.atproto.repo.putRecord", {
          input: {
            repo: agent.did,
            collection: ids.BuzzBookhiveCatalogBook,
            rkey: book.id,
            record: buildCatalogBookValue(book, blobMap.get(book.id)),
          },
        });

        if (!response.ok) {
          ctx.logger?.error({
            job: "catalog_book_put_record",
            outcome: "error",
            bookId: book.id,
            error: response.data,
          });
          return;
        }

        const uri = (response.data as { uri: string }).uri;
        if (!uri || uri === book.hiveBookAtUri) return;

        await ctx.db
          .updateTable("hive_book")
          .set({ hiveBookAtUri: uri, hiveBookCatalogUpdatedAt: book.updatedAt })
          .where("id", "=", book.id)
          .execute();
      }),
    );
  }
}

/**
 * Iterates all enriched hive_book rows without hiveBookAtUri, writing them to @bookhive.buzz
 * in batches of 25 with a 500ms pause between batches.
 */
export async function backfillCatalogBooks(
  ctx: CatalogCtx,
): Promise<{ written: number; batches: number }> {
  if (!ctx.serviceAccountAgent) return { written: 0, batches: 0 };

  const BATCH_SIZE = 25;
  let lastId = "";
  let written = 0;
  let batches = 0;
  const startTime = Date.now();

  const wideEvent: Record<string, unknown> = {
    job: "backfill_catalog_books",
  };

  try {
    while (true) {
      const batch = await ctx.db
        .selectFrom("hive_book")
        .selectAll()
        .where("hiveBookAtUri", "is", null)
        .where("enrichedAt", "is not", null)
        .where("id", ">", lastId as HiveId)
        .orderBy("id")
        .limit(BATCH_SIZE)
        .execute();

      if (batch.length === 0) break;

      await writeCatalogBooksBatch(ctx, batch);
      await new Promise((r) => setTimeout(r, 500));
      lastId = batch[batch.length - 1]!.id;
      written += batch.length;
      batches++;
    }

    wideEvent["outcome"] = "success";
    return { written, batches };
  } catch (err) {
    wideEvent["outcome"] = "error";
    wideEvent["error"] =
      err instanceof Error ? { message: err.message, type: err.name } : String(err);
    throw err;
  } finally {
    wideEvent["written"] = written;
    wideEvent["batches"] = batches;
    wideEvent["duration_ms"] = Date.now() - startTime;
    ctx.logger?.info(wideEvent);
  }
}
