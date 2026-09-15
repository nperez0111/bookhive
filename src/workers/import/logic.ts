/**
 * Import processing logic — runs in a Bun Worker thread.
 *
 * Design: parse CSV, then process each book sequentially — search, DB lookup,
 * accumulate matched books, flush PDS writes every BATCH_SIZE. Every step emits
 * SSE progress so the user always sees what's happening.
 */
import type { SessionClient } from "../../auth/client";
import { type BookIdentifiers, type HiveId } from "../../types";
import { Book as BookRecord } from "../../bsky/lexicon";
import {
  csvHeaderProblem,
  getGoodreadsCsvParser,
  getStorygraphCsvParser,
  getHardcoverCsvParser,
  parseHardcoverRecord,
  type GoodreadsBook,
  type StorygraphBook,
  type HardcoverBook,
} from "../../core/csv";
import { getUserRepoRecords, updateBookRecords, updateBookRecord } from "../../services/getBook";
import {
  normalizeStr,
  mapGoodreadsStatus,
  mapStorygraphStatus,
  mergeGoodreadsIdentifiers,
  mergeStorygraphIdentifiers,
  mergeHardcoverIdentifiers,
  buildGoodreadsBookRecord,
  buildStorygraphBookRecord,
  buildHardcoverBookRecord,
  deduplicateUnmatchedWithDetails,
  normalizeGoodreadsRating,
  normalizeStorygraphRating,
} from "../../core/importBook";
import { normalizeIsbn, normalizeIsbn13 } from "../../data/bookIdentifiers";
// Worker threads get isolated metric registries, so metrics here won't appear
// at the main /metrics endpoint — the main thread tracks import duration and
// active operations; per-book counts travel via SSE events instead.
import { searchBooks } from "../../services/searchBooks";
import { starsToDisplayRating } from "../../core/rating";
import type { ImportContext } from "./types";
import { errorMessage } from "../../lib/errors";

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
    await updateBookRecords({ ctx, agent, updates: batch, bookRecords, skipAutoDate: true });
  } catch (error) {
    ctx.addWideEventContext({
      import_batch_update: "failed",
      error: errorMessage(error),
      book_count: batch.size,
    });
    let individualSuccesses = 0;
    let individualFailures = 0;
    for (const [hiveId, bookUpdate] of batch.entries()) {
      try {
        await updateBookRecord({ ctx, agent, hiveId, updates: bookUpdate, skipAutoDate: true });
        individualSuccesses++;
      } catch (individualError) {
        individualFailures++;
        ctx.addWideEventContext({
          import_individual_book: "failed",
          error: errorMessage(individualError),
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

// ─── The one import pipeline ─────────────────────────────────────────────────

/**
 * Everything a CSV source has to supply. The three importers below are
 * descriptors over this one loop rather than near-identical copies — the
 * three had already drifted (differing rating math, ISBN cleanup, and array
 * conversion) before being unified.
 */
type CsvImportSource<TBook> = {
  /** Wire label, used in wide events. */
  name: string;
  requiredHeaders: string[];
  parser: () => TransformStream<Uint8Array, TBook>;
  title: (book: TBook) => string;
  /** The author string as stored in `hive_book.authors` for this source. */
  author: (book: TBook) => string;
  mergeIdentifiers: (
    book: TBook,
    existingIdentifiers: BookIdentifiers,
    hiveBookId: string,
  ) => { identifiers: BookIdentifiers; changed: boolean };
  buildRecord: (args: {
    book: TBook;
    hiveBook: { id: string; title: string; cover: string | null };
    existingHiveIds: Set<string>;
  }) => BookUpdate;
  /** Synthesises a source row from a book we failed to match, for the retry list. */
  makeFallbackBook: (bu: BookUpdate) => TBook;
  /** The per-book payload the client renders in the "couldn't match these" table. */
  toDetails: (entry: { book: TBook; reason: string }) => Record<string, unknown>;
};

async function processCsvImport<TBook>({
  csvData,
  ctx,
  agent,
  onSSE,
  source,
}: {
  csvData: ArrayBuffer;
  ctx: ImportContext;
  agent: SessionClient;
  onSSE: (data: string) => void | Promise<void>;
  source: CsvImportSource<TBook>;
}): Promise<void> {
  const id = { value: 0 };
  const matchedBooks = { value: 0 };
  const uploadedBooks = { value: 0 };
  const unmatchedBooks: Array<{ book: TBook; reason: string }> = [];
  const unmatchedSet = new Set<string>();

  await onSSE(
    sseJSON({
      event: "import-start",
      stage: "initializing",
      stageProgress: { message: "Reading CSV file..." },
      id: id.value++,
    }),
  );

  const headerProblem = csvHeaderProblem(csvData, source.requiredHeaders, source.name);
  if (headerProblem) {
    await onSSE(
      sseJSON({
        event: "import-error",
        stage: "error",
        error: headerProblem,
        stageProgress: { message: headerProblem },
        id: id.value++,
      }),
    );
    return;
  }

  // Phase 1: parse the entire CSV.
  const allBooks = await drainStream(new Blob([csvData]).stream().pipeThrough(source.parser()));
  const totalBooks = allBooks.length;

  // Start fetching the user's existing PDS records in the background.
  const bookRecords = getUserRepoRecords({ ctx, agent });
  const existingHiveIdsPromise = bookRecords.then(
    (br) => new Set(Array.from(br.books.values()).map((b) => b.hiveId)),
  );

  // Phase 2: search in groups of SEARCH_CONCURRENCY, process results in order.
  let currentBatch = new Map<HiveId, BookUpdate>();

  for (let i = 0; i < allBooks.length; i += SEARCH_CONCURRENCY) {
    const chunk = allBooks.slice(i, i + SEARCH_CONCURRENCY);
    // Fire every search in this chunk, then consume them in order.
    const searches = chunk.map((book) => searchBooks({ query: source.title(book), ctx }));

    for (let j = 0; j < chunk.length; j++) {
      const book = chunk[j]!;
      const title = source.title(book);
      const author = source.author(book);

      await onSSE(
        sseJSON({
          title,
          author,
          processed: matchedBooks.value,
          failed: unmatchedBooks.length,
          total: totalBooks,
          event: "book-load",
          stage: "searching",
          stageProgress: {
            current: i + j + 1,
            total: totalBooks,
            message: `Looking up "${title}"…`,
          },
          id: id.value++,
        }),
      );

      await searches[j];

      const hiveBook = await ctx.db
        .selectFrom("hive_book")
        .select(["id", "title", "cover", "identifiers"])
        .where("hive_book.rawTitle", "=", title)
        .where("authors", "=", author)
        .executeTakeFirst();

      if (!hiveBook) {
        const key = `${normalizeStr(title)}::${normalizeStr(author)}`;
        if (!unmatchedSet.has(key)) {
          unmatchedSet.add(key);
          unmatchedBooks.push({ book, reason: "no_match" });
        }
        continue;
      }

      const existingIdentifiers: BookIdentifiers = hiveBook.identifiers
        ? JSON.parse(hiveBook.identifiers)
        : {};
      const { identifiers: newIdentifiers, changed } = source.mergeIdentifiers(
        book,
        existingIdentifiers,
        hiveBook.id,
      );
      if (changed) {
        await persistMergedIdentifiers(ctx, hiveBook.id as HiveId, newIdentifiers);
      }

      const existingHiveIds = await existingHiveIdsPromise;
      currentBatch.set(
        hiveBook.id as HiveId,
        source.buildRecord({ book, hiveBook, existingHiveIds }),
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
          makeFallbackBook: source.makeFallbackBook,
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
    makeFallbackBook: source.makeFallbackBook,
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
        (b) => source.title(b),
        (b) => source.author(b),
        source.toDetails,
      ),
      id: id.value++,
    }),
  );
}

/**
 * Write merged identifiers back onto `hive_book` and keep `book_id_map` in
 * sync so `findBookIdentifiersByLookup` sees them.
 */
async function persistMergedIdentifiers(
  ctx: ImportContext,
  hiveId: HiveId,
  identifiers: BookIdentifiers,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await ctx.db
    .updateTable("hive_book")
    .set({ identifiers: JSON.stringify(identifiers), updatedAt })
    .where("id", "=", hiveId)
    .execute();
  await ctx.db
    .insertInto("book_id_map")
    .values({
      hiveId,
      isbn: identifiers.isbn10 ?? null,
      isbn13: identifiers.isbn13 ?? null,
      goodreadsId: identifiers.goodreadsId ?? null,
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

// ─── Sources ─────────────────────────────────────────────────────────────────

const goodreadsSource: CsvImportSource<GoodreadsBook> = {
  name: "goodreads",
  requiredHeaders: ["Book Id", "Title", "Author"],
  parser: getGoodreadsCsvParser,
  title: (b) => b.title,
  author: (b) => b.author,
  mergeIdentifiers: (book, existingIdentifiers, hiveBookId) =>
    mergeGoodreadsIdentifiers({
      bookId: book.bookId,
      isbn: book.isbn,
      isbn13: book.isbn13,
      existingIdentifiers,
      hiveBookId,
    }),
  buildRecord: ({ book, hiveBook, existingHiveIds }) =>
    buildGoodreadsBookRecord({ book, hiveBook, existingHiveIds }),
  makeFallbackBook: (bu) =>
    ({
      bookId: "",
      title: bu.title || "Unknown",
      author: bu.authors || "Unknown",
      authorLastFirst: "",
      additionalAuthors: [],
      isbn: "",
      isbn13: "",
      myRating: starsToDisplayRating(bu.stars) ?? 0,
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
    }) as GoodreadsBook,
  toDetails: (b) => ({
    title: b.book.title,
    author: b.book.author,
    isbn10: normalizeIsbn(b.book.isbn) ?? undefined,
    isbn13: normalizeIsbn13(b.book.isbn13) ?? undefined,
    stars: normalizeGoodreadsRating(b.book.myRating),
    review: b.book.myReview || undefined,
    finishedAt: b.book.dateRead ? b.book.dateRead.toISOString() : undefined,
    status: mapGoodreadsStatus(b.book),
    reason: b.reason,
  }),
};

const storygraphSource: CsvImportSource<StorygraphBook> = {
  name: "storygraph",
  requiredHeaders: ["Title", "Authors"],
  parser: getStorygraphCsvParser,
  title: (b) => b.title,
  author: (b) => b.authors,
  mergeIdentifiers: (book, existingIdentifiers, hiveBookId) =>
    mergeStorygraphIdentifiers({ isbn: book.isbn, existingIdentifiers, hiveBookId }),
  buildRecord: ({ book, hiveBook, existingHiveIds }) =>
    buildStorygraphBookRecord({ book, hiveBook, existingHiveIds }),
  makeFallbackBook: (bu) =>
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
      starRating: starsToDisplayRating(bu.stars) ?? 0,
      review: bu.review || "",
      contentWarnings: "",
      contentWarningDescription: "",
      tags: "",
      owned: false,
    }) as StorygraphBook,
  // StoryGraph ships one `isbn` column that may hold either width.
  toDetails: (b) => ({
    title: b.book.title,
    author: b.book.authors,
    isbn10: normalizeIsbn(b.book.isbn) ?? undefined,
    isbn13: normalizeIsbn13(b.book.isbn) ?? undefined,
    stars: normalizeStorygraphRating(b.book.starRating),
    review: b.book.review || undefined,
    finishedAt: b.book.lastDateRead ? b.book.lastDateRead.toISOString() : undefined,
    status: mapStorygraphStatus(b.book),
    reason: b.reason,
  }),
};

const hardcoverSource: CsvImportSource<HardcoverBook> = {
  name: "hardcover",
  requiredHeaders: ["Title", "Author", "Status"],
  parser: getHardcoverCsvParser,
  title: (b) => b.title,
  author: (b) => b.author,
  mergeIdentifiers: (book, existingIdentifiers, hiveBookId) =>
    mergeHardcoverIdentifiers({ book, existingIdentifiers, hiveBookId }),
  buildRecord: ({ book, hiveBook, existingHiveIds }) =>
    buildHardcoverBookRecord({ book, hiveBook, existingHiveIds }),
  makeFallbackBook: (bu) =>
    parseHardcoverRecord({
      Author: bu.authors || "Unknown",
      "Date Added": bu.createdAt ?? "",
      "Date Started": bu.startedAt ?? "",
      "Date Finished": bu.finishedAt ?? "",
      Rating: `${starsToDisplayRating(bu.stars) ?? 0}`,
      Review: bu.review || "",
      Status: bu.status || "",
      Title: bu.title || "Unknown",
    }),
  toDetails: (b) => ({
    title: b.book.title,
    author: b.book.author,
    isbn10: normalizeIsbn(b.book.isbn10) ?? undefined,
    isbn13: normalizeIsbn13(b.book.isbn13) ?? undefined,
    stars: b.book.rating || undefined,
    review: b.book.review || undefined,
    finishedAt: b.book.dateFinished ? b.book.dateFinished.toISOString() : undefined,
    status: b.book.status,
    reason: b.reason,
  }),
};

type ImportArgs = {
  csvData: ArrayBuffer;
  ctx: ImportContext;
  agent: SessionClient;
  onSSE: (data: string) => void | Promise<void>;
};

export const processGoodreadsImport = (a: ImportArgs) =>
  processCsvImport({ ...a, source: goodreadsSource });
export const processStorygraphImport = (a: ImportArgs) =>
  processCsvImport({ ...a, source: storygraphSource });
export const processHardcoverImport = (a: ImportArgs) =>
  processCsvImport({ ...a, source: hardcoverSource });
