import { iterateAtpRepo } from "@atcute/car";
import { Agent } from "@atproto/api";
import { TID } from "@atproto/common";

import type { AppContext } from "..";
import { ids } from "../bsky/lexicon/lexicons";
import * as BookRecord from "../bsky/lexicon/types/buzz/bookhive/book";
import * as BuzzRecord from "../bsky/lexicon/types/buzz/bookhive/buzz";
import type { HiveId, UserBook } from "../types";
import { uploadImageBlob } from "./uploadImageBlob";

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
      oc.column("uri").doUpdateSet((c) => ({
        indexedAt: c.ref("excluded.indexedAt"),
        cid: c.ref("excluded.cid"),
        authors: c.ref("excluded.authors"),
        title: c.ref("excluded.title"),
        hiveId: c.ref("excluded.hiveId"),
        status: c.ref("excluded.status"),
        startedAt: c.ref("excluded.startedAt"),
        finishedAt: c.ref("excluded.finishedAt"),
        review: c.ref("excluded.review"),
        stars: c.ref("excluded.stars"),
      })),
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

/**
 * Update a book in the user's PDS
 */
export async function updateBookRecords({
  ctx,
  agent,
  updates,
  bookRecords = getUserRepoRecords({ agent }),
  overwrite = false,
}: {
  ctx: AppContext;
  agent: Agent;
  updates: Map<HiveId, Partial<BookRecord.Record> & { coverImage?: string }>;
  bookRecords?: Promise<{
    books: Map<string, BookRecord.Record>;
  }>;
  overwrite?: boolean;
}): Promise<void> {
  const updatesToApply: Array<{
    type: "create" | "update";
    record: BookRecord.Record;
    rkey: string;
    userBook: Omit<UserBook, "uri" | "cid">;
  }> = [];

  for (const [hiveId, update] of updates.entries()) {
    const [rkey, originalBook] =
      (await bookRecords).books
        .entries()
        .find(([_rkey, book]) => book.hiveId === hiveId) ?? [];

    if (!overwrite && originalBook) {
      // If we're not overwriting, and the book already exists, skip it
      continue;
    }

    const book = BookRecord.validateRecord({
      $type: ids.BuzzBookhiveBook,
      // Always prefer original values
      title: originalBook?.title || update.title,
      authors: originalBook?.authors || update.authors,
      hiveId: originalBook?.hiveId || hiveId,
      createdAt: originalBook?.createdAt || new Date().toISOString(),
      cover:
        originalBook?.cover ||
        (await uploadImageBlob(update.coverImage, agent)),
      // Always prefer new values
      status: update.status || originalBook?.status,
      startedAt: update.startedAt || originalBook?.startedAt,
      finishedAt: update.finishedAt || originalBook?.finishedAt,
      review: update.review || originalBook?.review,
      stars: update.stars || originalBook?.stars,
    });

    if (!book.success) {
      throw new Error("Book incomplete or invalid: " + book.error.message);
    }

    const record = book.value as BookRecord.Record;

    updatesToApply.push({
      type: originalBook ? "update" : "create",
      record: record,
      rkey: rkey ?? TID.nextStr(),
      userBook: {
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
      },
    });
  }

  console.log("updatesToApply", updatesToApply);

  if (updatesToApply.length === 0) {
    return;
  }

  return;
  // const response = await agent.com.atproto.repo.applyWrites({
  //   repo: agent.assertDid,
  //   writes: updatesToApply.map(({ type, record, rkey }) => ({
  //     $type: `com.atproto.repo.applyWrites#${type}`,
  //     collection: ids.BuzzBookhiveBook,
  //     rkey,
  //     value: record,
  //   })),
  // });

  // if (
  //   !response.success ||
  //   !response.data.results ||
  //   response.data.results.length === 0
  // ) {
  //   throw new Error("Failed to record books");
  // }

  // await response.data.results.reduce(async (acc, result, index) => {
  //   await acc;
  //   const update = updatesToApply[index];
  //   if (
  //     result.$type === "com.atproto.repo.applyWrites#updateResult" ||
  //     result.$type === "com.atproto.repo.applyWrites#createResult"
  //   ) {
  //     await updateUserBook({
  //       ctx,
  //       userBook: { ...update.userBook, uri: result.uri, cid: result.cid },
  //     });
  //   }
  // }, Promise.resolve());

  // return;
}

/**
 * Get all the books and buzzes from a user's PDS repo
 */
export async function getUserRepoRecords({
  agent,
  did = agent.assertDid,
}: {
  agent: Agent;
  did?: string;
}): Promise<{
  /**
   * key is the rkey of the book
   */
  books: Map<string, BookRecord.Record>;
  /**
   * key is the rkey of the buzz
   */
  buzzes: Map<string, BuzzRecord.Record>;
}> {
  const { data } = await agent.com.atproto.sync.getRepo({
    did,
  });

  const books = new Map<string, BookRecord.Record>();
  const buzzes = new Map<string, BuzzRecord.Record>();

  for (const { collection, rkey: key, record: value } of iterateAtpRepo(data)) {
    switch (collection) {
      case ids.BuzzBookhiveBook: {
        const bookRaw = JSON.parse(JSON.stringify(value));
        console.log("isRecord", BookRecord.isRecord(bookRaw));
        const book = BookRecord.validateRecord(bookRaw);
        if (book.success) {
          books.set(key, book.value);
        } else {
          console.log(bookRaw);
          console.log("invalid book", key, book.error.message);
          throw new Error("Invalid book: " + book.error.message);
        }
        break;
      }
      case ids.BuzzBookhiveBuzz:
        buzzes.set(key, value as BuzzRecord.Record);
        break;
    }
  }

  console.log("books", books);
  console.log("buzzes", buzzes);
  console.log("did", did);

  return { books, buzzes };
}
