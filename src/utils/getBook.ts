import { Agent } from "@atproto/api";
import type { AppContext } from "..";
import { ids } from "../bsky/lexicon/lexicons";
import * as BookRecord from "../bsky/lexicon/types/buzz/bookhive/book";
import type { HiveId, UserBook } from "../types";
import { uploadImageBlob } from "./uploadImageBlob";
import { TID } from "@atproto/common";

export async function getUserBook({
  ctx,
  agent,
  hiveId,
}: {
  ctx: AppContext;
  agent: Agent;
  hiveId: HiveId;
}): Promise<UserBook | null> {
  return (
    (await ctx.db
      .selectFrom("user_book")
      .selectAll()
      .where("userDid", "=", agent.assertDid)
      .where("hiveId", "=", hiveId)
      .executeTakeFirst()) || null
  );
}

export async function updateUserBook({
  ctx,
  userBook,
}: {
  ctx: AppContext;
  userBook: UserBook;
}): Promise<void> {
  await ctx.db
    .insertInto("user_book")
    .values(userBook)
    .onConflict((oc) =>
      oc.column("uri").doUpdateSet({
        indexedAt: userBook.indexedAt,
        cid: userBook.cid,
        authors: userBook.authors,
        title: userBook.title,
        hiveId: userBook.hiveId,
        status: userBook.status,
        startedAt: userBook.startedAt,
        finishedAt: userBook.finishedAt,
        review: userBook.review,
        stars: userBook.stars,
      }),
    )
    .execute();
}
/**
 * Get a book from the user's PDS
 */
export async function getBookRecord({
  agent,
  cid,
  uri,
}: {
  agent: Agent;
  cid: string;
  uri: string;
}): Promise<BookRecord.Record | null> {
  const originalBook = (
    await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: ids.BuzzBookhiveBook,
      rkey: uri.split("/").at(-1)!,
      cid: cid,
    })
  ).data.value as BookRecord.Record | undefined;

  if (!originalBook) {
    return null;
  }

  return originalBook;
}

/**
 * Update a book in the user's PDS
 */
export async function updateBookRecord({
  ctx,
  agent,
  hiveId,
  updates,
}: {
  ctx: AppContext;
  agent: Agent;
  hiveId: HiveId;
  updates: Partial<BookRecord.Record> & { coverImage?: string };
}): Promise<{ book: BookRecord.Record; userBook: UserBook }> {
  const userBook = await getUserBook({ ctx, agent, hiveId });

  let originalBook: BookRecord.Record | null = null;
  if (userBook) {
    originalBook = await getBookRecord({
      agent,
      cid: userBook.cid,
      uri: userBook.uri,
    });
  }

  if (!originalBook) {
    // TODO do some checks here that we have everything for a new book then
    // validate does the minimum, but we should see that everything is there to display in UI
  }

  const book = BookRecord.validateRecord({
    // Always prefer original values
    title: originalBook?.title || updates.title,
    authors: originalBook?.authors || updates.authors,
    hiveId: originalBook?.hiveId || hiveId,
    createdAt: originalBook?.createdAt || new Date().toISOString(),
    cover:
      originalBook?.cover || (await uploadImageBlob(updates.coverImage, agent)),
    // Always prefer new values
    status: updates.status || originalBook?.status,
    startedAt: updates.startedAt || originalBook?.startedAt,
    finishedAt: updates.finishedAt || originalBook?.finishedAt,
    review: updates.review || originalBook?.review,
    stars: updates.stars || originalBook?.stars,
  });

  if (!book.success) {
    throw new Error("Book incomplete or invalid: " + book.error.message);
  }

  const record = book.value as BookRecord.Record;

  const response = await agent.com.atproto.repo.applyWrites({
    repo: agent.assertDid,
    writes: [
      {
        $type: originalBook
          ? "com.atproto.repo.applyWrites#update"
          : "com.atproto.repo.applyWrites#create",
        collection: ids.BuzzBookhiveBook,
        rkey: userBook ? userBook.uri.split("/").at(-1)! : TID.nextStr(),
        value: record,
      },
    ],
  });

  const firstResult = response.data.results?.[0];
  if (
    !response.success ||
    !response.data.results ||
    response.data.results.length === 0 ||
    !firstResult ||
    !(
      firstResult.$type === "com.atproto.repo.applyWrites#updateResult" ||
      firstResult.$type === "com.atproto.repo.applyWrites#createResult"
    )
  ) {
    throw new Error("Failed to record book");
  }
  const nextUserBook = {
    uri: firstResult.uri,
    cid: firstResult.cid,
    userDid: agent.assertDid,
    createdAt: record.createdAt,
    authors: record.authors,
    title: record.title,
    indexedAt: new Date().toISOString(),
    hiveId: record.hiveId as HiveId,
    status: record.status || null,
    startedAt: record.startedAt || null,
    finishedAt: record.finishedAt || null,
    review: record.review || null,
    stars: record.stars || null,
  };

  await updateUserBook({ ctx, userBook: nextUserBook });

  return { book: record, userBook: nextUserBook };
}
