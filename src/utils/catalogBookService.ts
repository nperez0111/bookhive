import { Client, CredentialManager } from "@atcute/client";
import type { SessionClient } from "../auth/client";
import type { AppContext } from "../context";
import { ids } from "../bsky/lexicon/ids";
import type { HiveBook } from "../types";

export async function createServiceAccountAgent(
  handle: string,
  appPassword: string,
): Promise<SessionClient | null> {
  if (!handle || !appPassword) return null;
  try {
    const manager = new CredentialManager({ service: "https://bsky.social" });
    await manager.login({ identifier: handle, password: appPassword });
    const client = new Client({ handler: manager });
    return {
      get did() {
        return manager.session!.did;
      },
      get: client.get.bind(client) as SessionClient["get"],
      post: client.post.bind(client) as SessionClient["post"],
    };
  } catch (err) {
    console.error(
      "[catalogBookService] Failed to create service account agent:",
      err,
    );
    return null;
  }
}

type CatalogCtx = Pick<AppContext, "db"> & {
  serviceAccountAgent: AppContext["serviceAccountAgent"] | undefined;
};

type ApplyWritesOut = {
  results?: Array<{ $type: string; uri?: string; cid?: string }>;
};

function buildCatalogBookValue(book: HiveBook) {
  return {
    $type: ids.BuzzBookhiveCatalogBook,
    id: book.id,
    title: book.title,
    authors: book.authors,
    thumbnail: book.thumbnail,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    ...(book.description
      ? { description: book.description.slice(0, 5000) }
      : {}),
    ...(book.cover ? { cover: book.cover } : {}),
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
      ? { genres: JSON.parse(book.genres) as string[] }
      : {}),
    ...(book.series ? { series: book.series } : {}),
    ...(book.identifiers
      ? { identifiers: JSON.parse(book.identifiers) as Record<string, string> }
      : {}),
  };
}

/**
 * Writes a single book to the @bookhive.buzz ATProto repo as a catalogBook record.
 * Skips if already written. Safe to call fire-and-forget.
 */
export async function writeCatalogBookIfNeeded(
  ctx: CatalogCtx,
  book: HiveBook,
): Promise<void> {
  if (!ctx.serviceAccountAgent) return;

  // Check current DB value — passed-in book may be from scraper without hiveBookAtUri
  const row = await ctx.db
    .selectFrom("hive_book")
    .select(["hiveBookAtUri"])
    .where("id", "=", book.id)
    .executeTakeFirst();

  if (row?.hiveBookAtUri) return;

  const agent = ctx.serviceAccountAgent;

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#create",
          collection: ids.BuzzBookhiveCatalogBook,
          rkey: book.id,
          value: buildCatalogBookValue(book),
        },
      ],
    },
  });

  const applyData = response.ok ? (response.data as ApplyWritesOut) : null;
  const uri = applyData?.results?.[0]?.uri;
  if (!uri) return;

  await ctx.db
    .updateTable("hive_book")
    .set({ hiveBookAtUri: uri })
    .where("id", "=", book.id)
    .execute();
}

/**
 * Writes a batch of up to 200 books to @bookhive.buzz in a single applyWrites call.
 * Splits into creates (no hiveBookAtUri) and updates (has hiveBookAtUri).
 */
export async function writeCatalogBooksBatch(
  ctx: CatalogCtx,
  books: HiveBook[],
): Promise<void> {
  if (!ctx.serviceAccountAgent || books.length === 0) return;

  const agent = ctx.serviceAccountAgent;
  const creates = books.filter((b) => !b.hiveBookAtUri);
  const updates = books.filter((b) => b.hiveBookAtUri);

  if (creates.length === 0 && updates.length === 0) return;

  const writes = [
    ...creates.map((book) => ({
      $type: "com.atproto.repo.applyWrites#create",
      collection: ids.BuzzBookhiveCatalogBook,
      rkey: book.id,
      value: buildCatalogBookValue(book),
    })),
    ...updates.map((book) => ({
      $type: "com.atproto.repo.applyWrites#update",
      collection: ids.BuzzBookhiveCatalogBook,
      rkey: book.id,
      value: buildCatalogBookValue(book),
    })),
  ];

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: { repo: agent.did, writes },
  });

  const applyData = response.ok ? (response.data as ApplyWritesOut) : null;
  if (!applyData?.results) return;

  // Creates come first in results, then updates
  const orderedBooks = [...creates, ...updates];
  await Promise.all(
    applyData.results.map(async (result, i) => {
      const book = orderedBooks[i];
      if (!book) return;
      const uri = result.uri ?? book.hiveBookAtUri;
      if (!uri || uri === book.hiveBookAtUri) return;
      await ctx.db
        .updateTable("hive_book")
        .set({ hiveBookAtUri: uri })
        .where("id", "=", book.id)
        .execute();
    }),
  );
}

/**
 * Iterates all hive_book rows without hiveBookAtUri, writing them to @bookhive.buzz
 * in batches of 200 with a 500ms pause between batches.
 */
export async function backfillCatalogBooks(
  ctx: CatalogCtx,
): Promise<{ written: number; batches: number }> {
  if (!ctx.serviceAccountAgent) return { written: 0, batches: 0 };

  const BATCH_SIZE = 200;
  let lastId = "";
  let written = 0;
  let batches = 0;

  while (true) {
    const batch = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("hiveBookAtUri", "is", null)
      .where("id", ">", lastId)
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

  return { written, batches };
}
