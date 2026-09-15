import { fromUint8Array } from "@atcute/repo";
import * as TID from "@atcute/tid";

import type { SessionClient } from "../auth/client";

import type { BookUtilContext } from "../context";
import { ids, Book as BookRecord, Buzz as BuzzRecord } from "../bsky/lexicon/index";
import type { BookIdentifiers, HiveId, PreviousRead, UserBook } from "../types";
import { findBookIdentifiersByLookup } from "../bsky/bookLookup";
import { toBookIdentifiersOutput } from "../data/bookIdentifiers";
import { uploadImageBlob } from "./uploadImageBlob";
import { BOOK_STATUS } from "../constants";
import { nextReadingState, readingDatesProblem } from "../core/bookLifecycle";
import { getBookRecord, INVALID_SWAP, writeBookRecord } from "./bookRecordWrite";
import { ensureBookCataloged, getCatalogedBookUri } from "./ensureBookCataloged";
import { completeUserBookRecord, type FollowUpOutcome } from "./userBookFollowUp";
import {
  getUserBook,
  recordFromUserBook,
  updateUserBook,
  userBookFromRecord,
} from "./userBookStore";

// Re-exported: the import worker and its tests import these from here.
export { getUserBook, updateUserBook } from "./userBookStore";
export { getBookRecord } from "./bookRecordWrite";

/**
 * A crashed request's lock is worthless after this; longer than any book write
 * takes, short enough that a user who hits refresh isn't stuck.
 */
const BOOK_LOCK_TTL_MS = 60_000;

/**
 * Serialize a DID's book writes against each other. Both write adapters must
 * set and check this lock — it protects nothing if only one of them checks.
 *
 * Returns a discriminated result rather than throwing, because the two adapters
 * answer differently — a 429 error page for the form, a JSON body for the API.
 *
 * Check-then-set, not compare-and-swap: the KV driver is SQLite-backed and
 * shared across worker processes, the TOCTOU window is narrow, and the worst
 * case is a duplicate write of an idempotent update.
 */
export async function withBookLock<T>(
  kv: BookUtilContext["kv"],
  did: string,
  hiveId: HiveId,
  fn: () => Promise<T>,
): Promise<{ locked: true; heldBy: unknown } | { locked: false; value: T }> {
  const key = "book_lock:" + did;

  const meta = await kv.getMeta(key);
  if (meta?.mtime) {
    if (Date.now() - new Date(meta.mtime).getTime() < BOOK_LOCK_TTL_MS) {
      const heldBy = await kv.getItem(key);
      if (heldBy) return { locked: true, heldBy };
    } else {
      await kv.removeItem(key);
    }
  }

  try {
    await kv.setItem(key, hiveId);
    return { locked: false, value: await fn() };
  } finally {
    await kv.removeItem(key);
  }
}

/** A write refused because of what the user typed, not because anything broke — both adapters map it to a 400. */
export class BookWriteError extends Error {}

/** Pure, so a CAS conflict can re-run it against what the PDS actually holds. */
function buildBookRecord({
  originalBook,
  updates,
  hiveId,
  identifiers,
  hiveBookUri,
  skipAutoDate,
}: {
  originalBook: BookRecord.Record | null;
  updates: Partial<BookRecord.Record>;
  hiveId: HiveId;
  identifiers: BookIdentifiers;
  hiveBookUri: string | undefined;
  skipAutoDate: boolean;
}): BookRecord.Record {
  // One transition, shared with the client's optimistic paint — see `core/bookLifecycle.ts`.
  const transition = nextReadingState(
    {
      status: originalBook?.status ?? null,
      startedAt: originalBook?.startedAt ?? null,
      finishedAt: originalBook?.finishedAt ?? null,
      previousReads: (originalBook?.previousReads as PreviousRead[] | undefined) ?? null,
    },
    {
      status: updates.status,
      startedAt: updates.startedAt,
      finishedAt: updates.finishedAt,
      bookProgress: updates.bookProgress,
    },
    { skipAutoDate },
  );

  const problem = readingDatesProblem(transition);
  if (problem) throw new BookWriteError(problem);

  const finalStatus = transition.status ?? undefined;

  const bookData = {
    $type: ids.BuzzBookhiveBook,
    // Always prefer original values
    title: originalBook?.title || updates.title,
    authors: originalBook?.authors || updates.authors,
    hiveId: originalBook?.hiveId || hiveId,
    createdAt: originalBook?.createdAt || new Date().toISOString(),
    // Patched in off the request path (userBookFollowUp.ts).
    cover: originalBook?.cover,
    // Always prefer new values (including auto-inferred status)
    status: finalStatus,
    // `nextReadingState` already resolved these against the record, including
    // the re-read clear — `null` means cleared, not "fall back to the original".
    startedAt: transition.startedAt ?? undefined,
    finishedAt: transition.finishedAt ?? undefined,
    review: updates.review || originalBook?.review,
    stars: updates.stars || originalBook?.stars,
    // When marking as finished, preserve progress but set to 100%
    bookProgress:
      finalStatus === BOOK_STATUS.FINISHED
        ? (() => {
            const prev = updates.bookProgress ?? originalBook?.bookProgress;
            if (!prev) return undefined;
            return {
              ...prev,
              percent: 100,
              currentPage: prev.totalPages ?? prev.currentPage,
              updatedAt: new Date().toISOString(),
            };
          })()
        : updates.bookProgress !== undefined
          ? updates.bookProgress
          : originalBook?.bookProgress,
    // Default to owned when first adding a book to library
    owned: updates.owned ?? originalBook?.owned ?? true,
    identifiers: Object.keys(identifiers).length > 0 ? identifiers : originalBook?.identifiers,
    hiveBookUri: hiveBookUri ?? originalBook?.hiveBookUri,
    // The transition owns the re-read rotation (archiving old dates on a
    // re-read); an explicit payload still wins.
    previousReads: updates.previousReads ?? transition.previousReads ?? undefined,
  };

  const book = BookRecord.validateRecord(bookData);

  if (!book.success) {
    throw new Error("Book incomplete or invalid: " + book.error.message);
  }

  return book.value as BookRecord.Record;
}

/**
 * Append to `progress_history` when a write moved the user's page. Lives next
 * to the `user_book` write, not in a route, so every writer gets it — the
 * table's contract is "every progress change is logged".
 * Deduped on `currentPage`. Failure is recorded and swallowed: the PDS write
 * already succeeded, so failing the caller here would report success as an error.
 */
async function recordProgressHistory({
  ctx,
  userDid,
  hiveId,
  progress,
}: {
  ctx: BookUtilContext;
  userDid: string;
  hiveId: HiveId;
  progress: BookRecord.Record["bookProgress"];
}): Promise<void> {
  if (!progress || progress.currentPage == null) return;

  try {
    const last = await ctx.db
      .selectFrom("progress_history")
      .select("currentPage")
      .where("userDid", "=", userDid)
      .where("hiveId", "=", hiveId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .executeTakeFirst();
    if (last && last.currentPage === progress.currentPage) return;

    await ctx.db
      .insertInto("progress_history")
      .values({
        userDid,
        hiveId,
        currentPage: progress.currentPage,
        totalPages: progress.totalPages ?? null,
        percent: progress.percent ?? null,
        createdAt: new Date().toISOString(),
      })
      .execute();
  } catch (error) {
    ctx.addWideEventContext({
      progress_history_write: "failed",
      progress_history_error: (error as Error).message,
    });
  }
}

/**
 * Write one change to a book's PDS record and mirror it to `user_book`.
 *
 * One PDS round-trip: the merge reads the local row (the PDS only on a pre-025
 * row or a CAS conflict), and the cover and catalogue link are patched in
 * afterwards by `followUp`, which never rejects.
 */
export async function updateBookRecord({
  ctx,
  agent,
  hiveId,
  updates,
  skipAutoDate = false,
}: {
  ctx: BookUtilContext;
  agent: SessionClient;
  hiveId: HiveId;
  updates: Partial<BookRecord.Record> & { coverImage?: string };
  skipAutoDate?: boolean;
}): Promise<{
  book: BookRecord.Record;
  userBook: UserBook;
  followUp: Promise<FollowUpOutcome>;
}> {
  const { coverImage, ...recordUpdates } = updates;
  const userBook = await getUserBook({ ctx, agent, hiveId });

  let original: { value: BookRecord.Record; cid: string } | null = null;
  if (userBook) {
    const local = recordFromUserBook(userBook);
    original = local
      ? { value: local, cid: userBook.cid }
      : await getBookRecord({ agent, uri: userBook.uri });
    ctx.addWideEventContext({ book_merge_source: local ? "local" : "pds" });
  }

  // A row with a URI has a record at that rkey; falling through to create would write over it.
  if (userBook && !original) {
    ctx.addWideEventContext({ book_record_read: "unusable" });
    throw new Error(`Failed to record book: could not read the current record for ${hiveId}`);
  }

  let coverSource = coverImage;
  if (!original && !userBook) {
    const hiveBook = await ctx.db
      .selectFrom("hive_book")
      .selectAll()
      .where("id", "=", hiveId)
      .executeTakeFirst();
    if (hiveBook) {
      coverSource ??= (hiveBook.cover || hiveBook.thumbnail) ?? undefined;
      Object.assign(recordUpdates, {
        title: hiveBook.title,
        authors: hiveBook.authors,
        ...recordUpdates,
      });
    }
  }

  const [identifiersRow, hiveBookUri] = await Promise.all([
    findBookIdentifiersByLookup({ ctx, hiveId }),
    getCatalogedBookUri(ctx, hiveId),
  ]);
  const identifiers = toBookIdentifiersOutput(identifiersRow);

  const build = (originalBook: BookRecord.Record | null) =>
    buildBookRecord({
      originalBook,
      updates: recordUpdates,
      hiveId,
      identifiers,
      hiveBookUri,
      skipAutoDate,
    });

  let record = build(original?.value ?? null);
  const rkey = userBook ? userBook.uri.split("/").at(-1)! : TID.now();
  let written = await writeBookRecord({
    agent,
    rkey,
    record,
    swapRecord: original?.cid ?? null,
  });

  if (!written.ok && written.error === INVALID_SWAP && userBook) {
    // Another client wrote first. Re-merge once; a second conflict is an error.
    const fresh = await getBookRecord({ agent, uri: userBook.uri });
    ctx.addWideEventContext({ book_merge_source: "pds_after_conflict" });
    if (fresh) {
      record = build(fresh.value);
      written = await writeBookRecord({ agent, rkey, record, swapRecord: fresh.cid });
    }
  }

  if (!written.ok) {
    throw new Error(
      `Failed to record book: ${written.error}${written.message ? ` (${written.message})` : ""}`,
    );
  }

  const nextUserBook = userBookFromRecord({
    uri: written.uri,
    cid: written.cid,
    userDid: agent.did,
    record,
  });
  await updateUserBook({ ctx, userBook: nextUserBook });
  await recordProgressHistory({ ctx, userDid: agent.did, hiveId, progress: record.bookProgress });

  const followUp = completeUserBookRecord({
    ctx,
    agent,
    userBook: nextUserBook,
    coverImage: coverSource,
  });

  return { book: record, userBook: nextUserBook, followUp };
}

export async function updateBookRecords({
  ctx,
  agent,
  updates,
  bookRecords = getUserRepoRecords({ ctx, agent }),
  overwrite = false,
  skipAutoDate = false,
}: {
  ctx: BookUtilContext;
  agent: SessionClient;
  updates: Map<HiveId, Partial<BookRecord.Record> & { coverImage?: string }>;
  bookRecords?: Promise<{
    books: Map<string, BookRecord.Record>;
  }>;
  overwrite?: boolean;
  skipAutoDate?: boolean;
}): Promise<void> {
  const updatesToApply: Array<{
    type: "create" | "update";
    record: BookRecord.Record;
    rkey: string;
    userBook: Omit<UserBook, "uri" | "cid">;
    originalUpdate: Partial<BookRecord.Record> & { coverImage?: string };
  }> = [];

  const bookMap = (await bookRecords).books;
  const hiveIds = [...updates.keys()];
  const idRows = await ctx.db
    .selectFrom("book_id_map")
    .where("hiveId", "in", hiveIds)
    .selectAll()
    .execute();
  const identifiersByHiveId = new Map(idRows.map((r) => [r.hiveId, toBookIdentifiersOutput(r)]));

  // Ensures all books are cataloged before writing to the PDS; failures are swallowed inside ensureBookCataloged.
  const hiveBookUriMap = new Map<HiveId, string | undefined>();
  if (ctx.serviceAccountAgent) {
    await Promise.allSettled(
      hiveIds.map(async (hiveId) => {
        hiveBookUriMap.set(hiveId, await ensureBookCataloged(ctx, hiveId));
      }),
    );
  }

  for (const [hiveId, update] of updates.entries()) {
    const [rkey, originalBook] =
      bookMap.entries().find(([_rkey, book]) => book.hiveId === hiveId) ?? [];

    // TODO maybe overwrite can overwrite just those properties we allow
    if (!overwrite && originalBook) {
      continue;
    }

    // Same record builder as the interactive write, so re-read archiving and
    // the identifiers fallback stay consistent across both paths.
    const idOutput = identifiersByHiveId.get(hiveId);

    const record = buildBookRecord({
      originalBook: originalBook ?? null,
      updates: update,
      hiveId,
      identifiers: idOutput ?? {},
      hiveBookUri: hiveBookUriMap.get(hiveId),
      skipAutoDate,
    });

    updatesToApply.push({
      type: originalBook ? "update" : "create",
      record: record,
      rkey: rkey ?? TID.now(),
      userBook: {
        userDid: agent.did,
        createdAt: record.createdAt,
        authors: record.authors,
        title: record.title,
        indexedAt: new Date().toISOString(),
        hiveId: record.hiveId as HiveId,
        status: record.status || null,
        owned: record.owned ? 1 : 0,
        startedAt: record.startedAt || null,
        finishedAt: record.finishedAt || null,
        review: record.review || null,
        stars: record.stars || null,
        bookProgress: record.bookProgress ?? null,
        previousReads: record.previousReads ?? null,
        record,
      },
      originalUpdate: update,
    });
  }

  if (updatesToApply.length === 0) {
    return;
  }

  await Promise.all(
    updatesToApply.map(async (u) => {
      if (!u.record.cover) {
        u.record.cover = (await uploadImageBlob(
          u.originalUpdate.coverImage,
          agent,
          800,
        )) as typeof u.record.cover;
      }
      return u;
    }),
  );

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: updatesToApply.map(({ type, record, rkey }) => ({
        $type: `com.atproto.repo.applyWrites#${type}`,
        collection: ids.BuzzBookhiveBook,
        rkey,
        value: record,
      })),
    },
  });

  type ApplyOutBulk = {
    results?: Array<{ $type: string; uri?: string; cid?: string }>;
  };
  const applyData2 = response.ok ? (response.data as ApplyOutBulk) : null;
  if (!response.ok || !applyData2?.results || applyData2.results.length === 0) {
    throw new Error("Failed to record books");
  }

  await applyData2.results.reduce(
    async (
      acc: Promise<void>,
      result: { $type: string; uri?: string; cid?: string },
      index: number,
    ) => {
      await acc;
      const update = updatesToApply[index]!;
      if (
        result.$type === "com.atproto.repo.applyWrites#updateResult" ||
        result.$type === "com.atproto.repo.applyWrites#createResult"
      ) {
        await updateUserBook({
          ctx,
          userBook: { ...update.userBook, uri: result.uri!, cid: result.cid! },
        });
      }
    },
    Promise.resolve(),
  );

  ctx.addWideEventContext({
    event: "wrote_books",
    userDid: agent.did,
    book_count: updatesToApply.length,
  });

  return;
}

export async function getUserRepoRecords({
  ctx,
  agent,
  did = agent.did,
}: {
  ctx: Pick<BookUtilContext, "addWideEventContext">;
  agent: SessionClient;
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
  const res = await agent.get("com.atproto.sync.getRepo", {
    params: { did },
    as: "bytes",
  });
  const data: Uint8Array = res.ok ? (res.data as Uint8Array) : new Uint8Array(0);

  const books = new Map<string, BookRecord.Record>();
  const buzzes = new Map<string, BuzzRecord.Record>();

  for (const { collection, rkey: key, record: value } of fromUint8Array(data)) {
    switch (collection) {
      case ids.BuzzBookhiveBook: {
        // JSON round-trip needed to get validation to pass: https://github.com/bluesky-social/atproto/issues/3866
        const book = BookRecord.validateRecord(
          JSON.parse(JSON.stringify(value)) as BookRecord.Record,
        );
        if (book.success) {
          books.set(key, book.value);
        }
        break;
      }
      case ids.BuzzBookhiveBuzz: {
        // JSON round-trip needed to get validation to pass: https://github.com/bluesky-social/atproto/issues/3866
        const buzz = BuzzRecord.validateRecord(
          JSON.parse(JSON.stringify(value)) as BuzzRecord.Record,
        );
        if (buzz.success) {
          buzzes.set(key, buzz.value);
        }
        break;
      }
    }
  }

  ctx.addWideEventContext({
    event: "fetched_repo",
    userDid: did,
    book_count: books.size,
    buzz_count: buzzes.size,
  });

  return { books, buzzes };
}
