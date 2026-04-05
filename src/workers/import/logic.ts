/**
 * Import processing logic — runs in a Bun Worker thread.
 *
 * Design: parse CSV, then process each book sequentially — search, DB lookup,
 * accumulate matched books, flush PDS writes every BATCH_SIZE. Every step emits
 * SSE progress so the user always sees what's happening.
 */
import type { SessionClient } from "../../auth/client";
import type { BookIdentifiers, HiveId } from "../../types";
import { Book as BookRecord } from "../../bsky/lexicon";
import {
  getGoodreadsCsvParser,
  getStorygraphCsvParser,
  type GoodreadsBook,
  type StorygraphBook,
} from "../../utils/csv";
import { getUserRepoRecords, updateBookRecords, updateBookRecord } from "../../utils/getBook";
import {
  normalizeStr,
  mapGoodreadsStatus,
  mapStorygraphStatus,
  mergeGoodreadsIdentifiers,
  mergeStorygraphIdentifiers,
  buildGoodreadsBookRecord,
  buildStorygraphBookRecord,
  deduplicateUnmatchedWithDetails,
} from "../../utils/importBook";
// Note: Worker threads get isolated metric registries, so metrics here won't appear
// at the main /metrics endpoint. The main thread (routes/import.ts) tracks import
// duration and active operations. Per-book counts are conveyed via SSE events.
import { searchBooks } from "../../routes/lib";
import type { ImportContext } from "./types";

/** Serialize an SSE payload with an auto-stamped ISO timestamp. */
function sseJSON(payload: Record<string, unknown>): string {
  return JSON.stringify({ ...payload, ts: new Date().toISOString() });
}

const BATCH_SIZE = 10;
const SEARCH_CONCURRENCY = 3;

/** Read all rows from a CSV ReadableStream into an array. */
async function drainStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const items: T[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    items.push(value);
  }
  return items;
}

type BookUpdate = Partial<BookRecord.Record> & {
  coverImage?: string;
  alreadyExists?: boolean;
};

/** Flush a batch of matched books to the user's PDS. */
async function flushBatch({
  batch,
  ctx,
  agent,
  bookRecords,
  onSSE,
  id,
  matchedBooks,
  uploadedBooks,
  unmatchedBooks,
  totalBooks,
  makeFallbackBook,
}: {
  batch: Map<HiveId, BookUpdate>;
  ctx: ImportContext;
  agent: SessionClient;
  bookRecords: Promise<{ books: Map<string, BookRecord.Record> }>;
  onSSE: (data: string) => void | Promise<void>;
  id: { value: number };
  matchedBooks: { value: number };
  uploadedBooks: { value: number };
  unmatchedBooks: Array<{ book: any; reason: string }>;
  totalBooks: number;
  makeFallbackBook: (bookUpdate: BookUpdate) => any;
}): Promise<void> {
  if (batch.size === 0) return;

  await onSSE(
    sseJSON({
      event: "batch-save",
      stage: "uploading",
      stageProgress: {
        current: matchedBooks.value,
        total: totalBooks,
        message: `Saving ${batch.size} books to your library…`,
      },
      id: id.value++,
    }),
  );

  try {
    await updateBookRecords({ ctx, agent, updates: batch, bookRecords });
  } catch (error) {
    ctx.addWideEventContext({
      import_batch_update: "failed",
      error: error instanceof Error ? error.message : String(error),
      book_count: batch.size,
    });
    let individualSuccesses = 0;
    let individualFailures = 0;
    for (const [hiveId, bookUpdate] of batch.entries()) {
      try {
        await updateBookRecord({ ctx, agent, hiveId, updates: bookUpdate });
        individualSuccesses++;
      } catch (individualError) {
        individualFailures++;
        ctx.addWideEventContext({
          import_individual_book: "failed",
          error:
            individualError instanceof Error ? individualError.message : String(individualError),
          hiveId,
        });
        unmatchedBooks.push({ book: makeFallbackBook(bookUpdate), reason: "update_error" });
      }
    }
    if (individualFailures > 0) {
      await onSSE(
        sseJSON({
          event: "import-error",
          stage: "uploading",
          stageProgress: {
            current: matchedBooks.value,
            total: totalBooks,
            message: `Individual save completed: ${individualSuccesses} succeeded, ${individualFailures} failed`,
          },
          error: `Individual save: ${individualSuccesses} succeeded, ${individualFailures} failed`,
          id: id.value++,
        }),
      );
    }
  }

  // Emit per-book upload events after the PDS write confirms
  const startProcessed = matchedBooks.value;
  let idx = 0;
  for (const book of batch.values()) {
    const processed = startProcessed + ++idx;
    const alreadyExists = !!(book as { alreadyExists?: boolean })["alreadyExists"];
    if (!alreadyExists) {
      uploadedBooks.value++;
    }
    await onSSE(
      sseJSON({
        title: book?.["title"],
        author: book?.["authors"],
        uploaded: 1,
        processed,
        failed: unmatchedBooks.length,
        total: totalBooks,
        event: "book-upload",
        stage: "uploading",
        stageProgress: {
          current: processed,
          total: totalBooks,
          message: `Uploading books to your library (${processed}/${totalBooks})`,
        },
        book: book
          ? {
              hiveId: book["hiveId"],
              title: book["title"],
              authors: book["authors"],
              coverImage: book["coverImage"],
              status: book["status"],
              finishedAt: book["finishedAt"],
              stars: book["stars"],
              review: book["review"],
              alreadyExists: book["alreadyExists"],
            }
          : undefined,
        id: id.value++,
      }),
    );
  }
  matchedBooks.value += batch.size;
}

// ─── Goodreads ───────────────────────────────────────────────────────────────

export async function processGoodreadsImport({
  csvData,
  ctx,
  agent,
  onSSE,
}: {
  csvData: ArrayBuffer;
  ctx: ImportContext;
  agent: SessionClient;
  onSSE: (data: string) => void | Promise<void>;
}): Promise<void> {
  const id = { value: 0 };
  const matchedBooks = { value: 0 };
  const uploadedBooks = { value: 0 };
  const unmatchedBooks: Array<{ book: GoodreadsBook; reason: string }> = [];
  const unmatchedSet = new Set<string>();

  await onSSE(
    sseJSON({
      event: "import-start",
      stage: "initializing",
      stageProgress: { message: "Reading CSV file..." },
      id: id.value++,
    }),
  );

  // Phase 1: Parse entire CSV
  const allBooks = await drainStream(
    new Blob([csvData]).stream().pipeThrough(getGoodreadsCsvParser()),
  );
  const totalBooks = allBooks.length;

  // Start fetching user's existing PDS records in the background
  const bookRecords = getUserRepoRecords({ ctx, agent });
  const existingHiveIdsPromise = bookRecords.then(
    (br) => new Set(Array.from(br.books.values()).map((b) => b.hiveId)),
  );

  // Phase 2: Search in groups of SEARCH_CONCURRENCY, process results in order
  let currentBatch = new Map<HiveId, BookUpdate>();
  const grFallback = (bu: BookUpdate) =>
    ({
      bookId: "",
      title: bu.title || "Unknown",
      author: bu.authors || "Unknown",
      authorLastFirst: "",
      additionalAuthors: [],
      isbn: "",
      isbn13: "",
      myRating: bu.stars ? bu.stars / 2 : 0,
      averageRating: 0,
      publisher: "",
      binding: "",
      numberOfPages: 0,
      yearPublished: 0,
      originalPublicationYear: 0,
      dateRead: bu.finishedAt ? new Date(bu.finishedAt) : null,
      dateAdded: new Date(),
      bookshelves: [],
      bookshelvesWithPositions: "",
      exclusiveShelf: "",
      myReview: bu.review || "",
      spoiler: false,
      privateNotes: "",
      readCount: 0,
      ownedCopies: 0,
    }) as GoodreadsBook;

  for (let i = 0; i < allBooks.length; i += SEARCH_CONCURRENCY) {
    const chunk = allBooks.slice(i, i + SEARCH_CONCURRENCY);

    // Fire all searches in this chunk (non-blocking)
    const searches = chunk.map((book) => searchBooks({ query: book.title, ctx }));

    // Process each book in order, awaiting its search
    for (let j = 0; j < chunk.length; j++) {
      const book = chunk[j]!;
      const bookIdx = i + j;

      await onSSE(
        sseJSON({
          title: book.title,
          author: book.author,
          processed: matchedBooks.value,
          failed: unmatchedBooks.length,
          total: totalBooks,
          event: "book-load",
          stage: "searching",
          stageProgress: {
            current: bookIdx + 1,
            total: totalBooks,
            message: `Looking up "${book.title}"…`,
          },
          id: id.value++,
        }),
      );

      // Await this book's search (others in the chunk are already in-flight)
      await searches[j];

      const hiveBook = await ctx.db
        .selectFrom("hive_book")
        .select(["id", "title", "cover", "identifiers"])
        .where("hive_book.rawTitle", "=", book.title)
        .where("authors", "=", book.author)
        .executeTakeFirst();

      if (!hiveBook) {
        const key = `${normalizeStr(book.title)}::${normalizeStr(book.author)}`;
        if (!unmatchedSet.has(key)) {
          unmatchedSet.add(key);
          unmatchedBooks.push({ book, reason: "no_match" });
        }
        continue;
      }

      const existingIdentifiers: BookIdentifiers = hiveBook.identifiers
        ? JSON.parse(hiveBook.identifiers)
        : {};
      const { identifiers: newIdentifiers, changed } = mergeGoodreadsIdentifiers({
        bookId: book.bookId,
        isbn: book.isbn,
        isbn13: book.isbn13,
        existingIdentifiers,
        hiveBookId: hiveBook.id,
      });
      if (changed) {
        const updatedAt = new Date().toISOString();
        await ctx.db
          .updateTable("hive_book")
          .set({
            identifiers: JSON.stringify(newIdentifiers),
            updatedAt,
          })
          .where("id", "=", hiveBook.id)
          .execute();
        // Keep book_id_map in sync so findBookIdentifiersByLookup sees the merged IDs
        await ctx.db
          .insertInto("book_id_map")
          .values({
            hiveId: hiveBook.id as HiveId,
            isbn: newIdentifiers.isbn10 ?? null,
            isbn13: newIdentifiers.isbn13 ?? null,
            goodreadsId: newIdentifiers.goodreadsId ?? null,
            updatedAt,
          })
          .onConflict((oc) =>
            oc.column("hiveId").doUpdateSet((eb) => ({
              isbn: eb.ref("excluded.isbn"),
              isbn13: eb.ref("excluded.isbn13"),
              goodreadsId: eb.ref("excluded.goodreadsId"),
              updatedAt: eb.ref("excluded.updatedAt"),
            })),
          )
          .execute();
      }

      const existingHiveIds = await existingHiveIdsPromise;
      currentBatch.set(
        hiveBook.id as HiveId,
        buildGoodreadsBookRecord({ book, hiveBook, existingHiveIds }),
      );

      if (currentBatch.size >= BATCH_SIZE) {
        await flushBatch({
          batch: currentBatch,
          ctx,
          agent,
          bookRecords,
          onSSE,
          id,
          matchedBooks,
          uploadedBooks,
          unmatchedBooks,
          totalBooks,
          makeFallbackBook: grFallback,
        });
        currentBatch = new Map();
      }
    } // end inner for (j)
  } // end outer for (i += SEARCH_CONCURRENCY)

  // Flush remaining
  await flushBatch({
    batch: currentBatch,
    ctx,
    agent,
    bookRecords,
    onSSE,
    id,
    matchedBooks,
    uploadedBooks,
    unmatchedBooks,
    totalBooks,
    makeFallbackBook: grFallback,
  });

  await onSSE(
    sseJSON({
      event: "import-complete",
      stage: "complete",
      stageProgress: {
        current: matchedBooks.value,
        total: totalBooks,
        message: `Import complete! Successfully imported ${uploadedBooks.value} books${unmatchedBooks.length > 0 ? ` (${unmatchedBooks.length} failed)` : ""}`,
      },
      ...deduplicateUnmatchedWithDetails(
        unmatchedBooks,
        (b) => b.title,
        (b) => b.author,
        (b) => ({
          title: b.book.title,
          author: b.book.author,
          isbn10: b.book.isbn || undefined,
          isbn13: b.book.isbn13 || undefined,
          stars: b.book.myRating ? b.book.myRating * 2 : undefined,
          review: b.book.myReview || undefined,
          finishedAt: b.book.dateRead ? b.book.dateRead.toISOString() : undefined,
          status: mapGoodreadsStatus(b.book),
          reason: b.reason,
        }),
      ),
      id: id.value++,
    }),
  );
}

// ─── StoryGraph ──────────────────────────────────────────────────────────────

export async function processStorygraphImport({
  csvData,
  ctx,
  agent,
  onSSE,
}: {
  csvData: ArrayBuffer;
  ctx: ImportContext;
  agent: SessionClient;
  onSSE: (data: string) => void | Promise<void>;
}): Promise<void> {
  const id = { value: 0 };
  const matchedBooks = { value: 0 };
  const uploadedBooks = { value: 0 };
  const unmatchedBooks: Array<{ book: StorygraphBook; reason: string }> = [];
  const unmatchedSet = new Set<string>();

  await onSSE(
    sseJSON({
      event: "import-start",
      stage: "initializing",
      stageProgress: { message: "Reading CSV file..." },
      id: id.value++,
    }),
  );

  const allBooks = await drainStream(
    new Blob([csvData]).stream().pipeThrough(getStorygraphCsvParser()),
  );
  const totalBooks = allBooks.length;

  const bookRecords = getUserRepoRecords({ ctx, agent });
  const existingHiveIdsPromise = bookRecords.then(
    (br) => new Set(Array.from(br.books.values()).map((b) => b.hiveId)),
  );

  let currentBatch = new Map<HiveId, BookUpdate>();
  const sgFallback = (bu: BookUpdate) =>
    ({
      title: bu.title || "Unknown",
      authors: bu.authors || "Unknown",
      contributors: "",
      isbn: "",
      format: "",
      readStatus: "",
      dateAdded: null,
      lastDateRead: bu.finishedAt ? new Date(bu.finishedAt) : null,
      datesRead: "",
      readCount: 0,
      moods: "",
      pace: "",
      characterOrPlot: "",
      strongCharacterDevelopment: "",
      loveableCharacters: "",
      diverseCharacters: "",
      flawedCharacters: "",
      starRating: bu.stars ? bu.stars / 2 : 0,
      review: bu.review || "",
      contentWarnings: "",
      contentWarningDescription: "",
      tags: "",
      owned: false,
    }) as StorygraphBook;

  for (let i = 0; i < allBooks.length; i += SEARCH_CONCURRENCY) {
    const chunk = allBooks.slice(i, i + SEARCH_CONCURRENCY);

    // Fire all searches in this chunk (non-blocking)
    const searches = chunk.map((book) => searchBooks({ query: book.title, ctx }));

    for (let j = 0; j < chunk.length; j++) {
      const book = chunk[j]!;
      const bookIdx = i + j;

      await onSSE(
        sseJSON({
          title: book.title,
          author: book.authors,
          processed: matchedBooks.value,
          failed: unmatchedBooks.length,
          total: totalBooks,
          event: "book-load",
          stage: "searching",
          stageProgress: {
            current: bookIdx + 1,
            total: totalBooks,
            message: `Looking up "${book.title}"…`,
          },
          id: id.value++,
        }),
      );

      await searches[j];

      const hiveBook = await ctx.db
        .selectFrom("hive_book")
        .select(["id", "title", "cover", "identifiers"])
        .where("hive_book.rawTitle", "=", book.title)
        .where("authors", "=", book.authors)
        .executeTakeFirst();

      if (!hiveBook) {
        const key = `${normalizeStr(book.title)}::${normalizeStr(book.authors)}`;
        if (!unmatchedSet.has(key)) {
          unmatchedSet.add(key);
          unmatchedBooks.push({ book, reason: "no_match" });
        }
        continue;
      }

      const existingIdentifiers: BookIdentifiers = hiveBook.identifiers
        ? JSON.parse(hiveBook.identifiers)
        : {};
      const { identifiers: newIdentifiers, changed } = mergeStorygraphIdentifiers({
        isbn: book.isbn,
        existingIdentifiers,
        hiveBookId: hiveBook.id,
      });
      if (changed) {
        const updatedAt = new Date().toISOString();
        await ctx.db
          .updateTable("hive_book")
          .set({
            identifiers: JSON.stringify(newIdentifiers),
            updatedAt,
          })
          .where("id", "=", hiveBook.id)
          .execute();
        // Keep book_id_map in sync so findBookIdentifiersByLookup sees the merged IDs
        await ctx.db
          .insertInto("book_id_map")
          .values({
            hiveId: hiveBook.id as HiveId,
            isbn: newIdentifiers.isbn10 ?? null,
            isbn13: newIdentifiers.isbn13 ?? null,
            goodreadsId: newIdentifiers.goodreadsId ?? null,
            updatedAt,
          })
          .onConflict((oc) =>
            oc.column("hiveId").doUpdateSet((eb) => ({
              isbn: eb.ref("excluded.isbn"),
              isbn13: eb.ref("excluded.isbn13"),
              goodreadsId: eb.ref("excluded.goodreadsId"),
              updatedAt: eb.ref("excluded.updatedAt"),
            })),
          )
          .execute();
      }

      const existingHiveIds = await existingHiveIdsPromise;
      currentBatch.set(
        hiveBook.id as HiveId,
        buildStorygraphBookRecord({ book, hiveBook, existingHiveIds }),
      );

      if (currentBatch.size >= BATCH_SIZE) {
        await flushBatch({
          batch: currentBatch,
          ctx,
          agent,
          bookRecords,
          onSSE,
          id,
          matchedBooks,
          uploadedBooks,
          unmatchedBooks,
          totalBooks,
          makeFallbackBook: sgFallback,
        });
        currentBatch = new Map();
      }
    }
  }

  await flushBatch({
    batch: currentBatch,
    ctx,
    agent,
    bookRecords,
    onSSE,
    id,
    matchedBooks,
    uploadedBooks,
    unmatchedBooks,
    totalBooks,
    makeFallbackBook: sgFallback,
  });

  await onSSE(
    sseJSON({
      event: "import-complete",
      stage: "complete",
      stageProgress: {
        current: matchedBooks.value,
        total: totalBooks,
        message: `Import complete! Successfully imported ${uploadedBooks.value} books${unmatchedBooks.length > 0 ? ` (${unmatchedBooks.length} failed)` : ""}`,
      },
      ...deduplicateUnmatchedWithDetails(
        unmatchedBooks,
        (b) => b.title,
        (b) => b.authors,
        (b) => {
          const cleanIsbn = b.book.isbn?.replace(/[-\s]/g, "") || "";
          return {
            title: b.book.title,
            author: b.book.authors,
            isbn10: cleanIsbn.length === 10 ? cleanIsbn : undefined,
            isbn13: cleanIsbn.length === 13 ? cleanIsbn : undefined,
            stars: b.book.starRating ? b.book.starRating * 2 : undefined,
            review: b.book.review || undefined,
            finishedAt: b.book.lastDateRead ? b.book.lastDateRead.toISOString() : undefined,
            status: mapStorygraphStatus(b.book),
            reason: b.reason,
          };
        },
      ),
      id: id.value++,
    }),
  );
}
