/**
 * Import routes: Goodreads and StoryGraph CSV upload (SSE streaming).
 * Mount at /import so paths are /import/goodreads, /import/storygraph.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { AppEnv } from "../context";
import type { BookIdentifiers, HiveId } from "../types";
import { Book as BookRecord } from "../bsky/lexicon";
import { createBatchTransform } from "../utils/batchTransform";
import {
  getGoodreadsCsvParser,
  getStorygraphCsvParser,
  type GoodreadsBook,
  type StorygraphBook,
} from "../utils/csv";
import {
  getUserRepoRecords,
  updateBookRecords,
  updateBookRecord,
} from "../utils/getBook";
import { searchBooks } from "./lib";

const importApp = new Hono<AppEnv>();

importApp.post(
  "/goodreads",
  zValidator(
    "form",
    z.object({
      export: z.instanceof(File),
    }),
  ),
  async (c) => {
    const ctx = c.get("ctx");
    const agent = await ctx.getSessionAgent();
    if (!agent) {
      return c.json({ success: false, error: "Invalid Session" }, 401);
    }

    const { export: exportFile } = c.req.valid("form");
    return streamSSE(c, async (stream) => {
      const normalizeStr = (s: string) =>
        s?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
      const parser = getGoodreadsCsvParser();
      let id = 0;
      let totalBooks = 0;
      let matchedBooks = 0;
      let uploadedBooks = 0;
      const unmatchedBooks: Array<{ book: GoodreadsBook; reason: string }> = [];
      const unmatchedSet = new Set<string>();

      await stream.writeSSE({
        data: JSON.stringify({
          event: "import-start",
          stage: "initializing",
          stageProgress: { message: "Starting import process..." },
          id: id++,
        }),
      });

      const [countStream, uploadStream] = exportFile
        .stream()
        .pipeThrough(parser)
        .tee();

      countStream.pipeTo(
        new WritableStream({
          async write(book) {
            searchBooks({ query: book.title, ctx });
            totalBooks++;
          },
        }),
      );

      const bookRecords = getUserRepoRecords({ ctx, agent });
      const existingHiveIdsPromise = bookRecords.then(
        (br) => new Set(Array.from(br.books.values()).map((b) => b.hiveId)),
      );

      await stream.writeSSE({
        data: JSON.stringify({
          event: "upload-start",
          stage: "uploading",
          stageProgress: {
            current: 0,
            total: totalBooks,
            message: "Starting to upload books to your library...",
          },
          id: id++,
        }),
      });

      await uploadStream
        .pipeThrough(
          createBatchTransform(
            25,
            async (
              books,
            ): Promise<
              Map<
                HiveId,
                Partial<BookRecord.Record> & {
                  coverImage?: string;
                  alreadyExists?: boolean;
                }
              >
            > => {
              return new Map(
                (
                  await Promise.all(
                    books.map(async (book) => {
                      try {
                        await stream.writeSSE({
                          data: JSON.stringify({
                            title: book.title,
                            author: book.author,
                            processed: matchedBooks,
                            failed: unmatchedBooks.length,
                            failedBooks: unmatchedBooks.map((b) => ({
                              title: b.book.title,
                              author: b.book.author,
                            })),
                            total: totalBooks,
                            event: "book-load",
                            stage: "searching",
                            stageProgress: {
                              current: totalBooks,
                              total: "unknown",
                              message: "Searching for books in Hive...",
                            },
                            id: id++,
                          }),
                        });
                        await searchBooks({ query: book.title, ctx });
                        let hiveBook = await ctx.db
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
                          return null;
                        }

                        const existingIdentifiers: BookIdentifiers =
                          hiveBook.identifiers
                            ? JSON.parse(hiveBook.identifiers)
                            : {};
                        const newIdentifiers: BookIdentifiers = {
                          ...existingIdentifiers,
                          hiveId: hiveBook.id,
                          goodreadsId:
                            book.bookId || existingIdentifiers.goodreadsId,
                          isbn10: book.isbn || existingIdentifiers.isbn10,
                          isbn13: book.isbn13 || existingIdentifiers.isbn13,
                        };
                        if (
                          newIdentifiers.goodreadsId !==
                            existingIdentifiers.goodreadsId ||
                          newIdentifiers.isbn10 !==
                            existingIdentifiers.isbn10 ||
                          newIdentifiers.isbn13 !==
                            existingIdentifiers.isbn13 ||
                          !existingIdentifiers.hiveId
                        ) {
                          await ctx.db
                            .updateTable("hive_book")
                            .set({
                              identifiers: JSON.stringify(newIdentifiers),
                            })
                            .where("id", "=", hiveBook.id)
                            .execute();
                        }

                        const existingHiveIds = await existingHiveIdsPromise;
                        return [
                          hiveBook.id as HiveId,
                          {
                            authors: book.author,
                            title: hiveBook.title,
                            status: book.dateRead
                              ? "buzz.bookhive.defs#finished"
                              : "buzz.bookhive.defs#wantToRead",
                            hiveId: hiveBook.id,
                            coverImage: hiveBook.cover ?? undefined,
                            finishedAt:
                              book.dateRead?.toISOString() ?? undefined,
                            stars: book.myRating
                              ? book.myRating * 2
                              : undefined,
                            review: book.myReview ?? undefined,
                            alreadyExists: existingHiveIds.has(hiveBook.id),
                          },
                        ] as const;
                      } catch (e) {
                        ctx.logger.error(
                          { error: e, book },
                          "Failed to update book record",
                        );
                        unmatchedBooks.push({
                          book,
                          reason: "processing_error",
                        });
                        return null;
                      }
                    }),
                  )
                ).filter((a) => a !== null),
              );
            },
          ),
        )
        .pipeTo(
          new WritableStream({
            async write(bookUpdates) {
              const startProcessed = matchedBooks;
              let idx = 0;
              for (const book of bookUpdates.values()) {
                const processed = startProcessed + ++idx;
                await stream.writeSSE({
                  data: JSON.stringify({
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
                    id: id++,
                  }),
                });
                if (
                  book &&
                  !(book as { alreadyExists?: boolean })["alreadyExists"]
                ) {
                  uploadedBooks++;
                }
              }
              matchedBooks += bookUpdates.size;

              try {
                await updateBookRecords({
                  ctx,
                  agent,
                  updates: bookUpdates,
                  bookRecords,
                });
              } catch (error) {
                ctx.logger.error(
                  { error, bookCount: bookUpdates.size },
                  "Failed to update book records in batch, trying individually",
                );
                let individualSuccesses = 0;
                let individualFailures = 0;
                for (const [hiveId, bookUpdate] of bookUpdates.entries()) {
                  try {
                    await updateBookRecord({
                      ctx,
                      agent,
                      hiveId,
                      updates: bookUpdate,
                    });
                    individualSuccesses++;
                    if (
                      !(bookUpdate as { alreadyExists?: boolean })[
                        "alreadyExists"
                      ]
                    ) {
                      uploadedBooks++;
                    }
                  } catch (individualError) {
                    individualFailures++;
                    ctx.logger.error(
                      {
                        error: individualError,
                        hiveId,
                        bookUpdate: bookUpdate as Record<string, unknown>,
                      },
                      "Failed to update individual book record",
                    );
                    unmatchedBooks.push({
                      book: {
                        bookId: "",
                        title: bookUpdate.title || "Unknown",
                        author: bookUpdate.authors || "Unknown",
                        authorLastFirst: "",
                        additionalAuthors: [],
                        isbn: "",
                        isbn13: "",
                        myRating: bookUpdate.stars ? bookUpdate.stars / 2 : 0,
                        averageRating: 0,
                        publisher: "",
                        binding: "",
                        numberOfPages: 0,
                        yearPublished: 0,
                        originalPublicationYear: 0,
                        dateRead: bookUpdate.finishedAt
                          ? new Date(bookUpdate.finishedAt)
                          : null,
                        dateAdded: new Date(),
                        bookshelves: [],
                        bookshelvesWithPositions: "",
                        exclusiveShelf: "",
                        myReview: bookUpdate.review || "",
                        spoiler: false,
                        privateNotes: "",
                        readCount: 0,
                        ownedCopies: 0,
                      } as GoodreadsBook,
                      reason: "update_error",
                    });
                  }
                }
                if (individualFailures > 0) {
                  await stream.writeSSE({
                    data: JSON.stringify({
                      event: "import-error",
                      stage: "uploading",
                      stageProgress: {
                        current: matchedBooks,
                        total: totalBooks,
                        message: `Individual save completed: ${individualSuccesses} succeeded, ${individualFailures} failed`,
                      },
                      error: `Individual save: ${individualSuccesses} succeeded, ${individualFailures} failed`,
                      id: id++,
                    }),
                  });
                }
              }
            },
          }),
        );

      await stream.writeSSE({
        data: JSON.stringify({
          event: "import-complete",
          stage: "complete",
          stageProgress: {
            current: matchedBooks,
            total: totalBooks,
            message: `Import complete! Successfully imported ${uploadedBooks} books${unmatchedBooks.length > 0 ? ` (${unmatchedBooks.length} failed)` : ""}`,
          },
          failedBooks: Array.from(
            new Map(
              unmatchedBooks.map((b) => [
                `${normalizeStr(b.book.title)}::${normalizeStr(b.book.author)}`,
                { title: b.book.title, author: b.book.author },
              ]),
            ).values(),
          ),
          failedBookDetails: unmatchedBooks.map((b) => ({
            title: b.book.title,
            author: b.book.author,
            isbn10: b.book.isbn || undefined,
            isbn13: b.book.isbn13 || undefined,
            stars: b.book.myRating ? b.book.myRating * 2 : undefined,
            review: b.book.myReview || undefined,
            finishedAt: b.book.dateRead
              ? b.book.dateRead.toISOString()
              : undefined,
            status: b.book.dateRead ? "buzz.bookhive.defs#finished" : undefined,
            reason: b.reason,
          })),
          id: id++,
        }),
      });
    });
  },
);

importApp.post(
  "/storygraph",
  zValidator(
    "form",
    z.object({
      export: z.instanceof(File),
    }),
  ),
  async (c) => {
    const ctx = c.get("ctx");
    const agent = await ctx.getSessionAgent();
    if (!agent) {
      return c.json({ success: false, error: "Invalid Session" }, 401);
    }

    const { export: exportFile } = c.req.valid("form");
    return streamSSE(c, async (stream) => {
      const normalizeStr = (s: string) =>
        s?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
      const parser = getStorygraphCsvParser();
      let id = 0;
      let totalBooks = 0;
      let matchedBooks = 0;
      let uploadedBooks = 0;
      const unmatchedBooks: Array<{
        book: StorygraphBook;
        reason: string;
      }> = [];
      const unmatchedSet = new Set<string>();

      await stream.writeSSE({
        data: JSON.stringify({
          event: "import-start",
          stage: "initializing",
          stageProgress: { message: "Starting import process..." },
          id: id++,
        }),
      });

      const [countStream, uploadStream] = exportFile
        .stream()
        .pipeThrough(parser)
        .tee();

      countStream.pipeTo(
        new WritableStream({
          async write(book) {
            searchBooks({ query: book.title, ctx });
            totalBooks++;
          },
        }),
      );

      const bookRecords = getUserRepoRecords({ ctx, agent });
      const existingHiveIdsPromise = bookRecords.then(
        (br) => new Set(Array.from(br.books.values()).map((b) => b.hiveId)),
      );

      await stream.writeSSE({
        data: JSON.stringify({
          event: "upload-start",
          stage: "uploading",
          stageProgress: {
            current: 0,
            total: totalBooks,
            message: "Starting to upload books to your library...",
          },
          id: id++,
        }),
      });

      await uploadStream
        .pipeThrough(
          createBatchTransform(
            25,
            async (
              books,
            ): Promise<
              Map<
                HiveId,
                Partial<BookRecord.Record> & {
                  coverImage?: string;
                  alreadyExists?: boolean;
                }
              >
            > => {
              return new Map(
                (
                  await Promise.all(
                    books.map(async (book) => {
                      try {
                        await stream.writeSSE({
                          data: JSON.stringify({
                            title: book.title,
                            author: book.authors,
                            processed: matchedBooks,
                            failed: unmatchedBooks.length,
                            failedBooks: unmatchedBooks.map((b) => ({
                              title: b.book.title,
                              author: b.book.authors,
                            })),
                            total: totalBooks,
                            event: "book-load",
                            stage: "searching",
                            stageProgress: {
                              current: totalBooks,
                              total: "unknown",
                              message: "Searching for books in Hive...",
                            },
                            id: id++,
                          }),
                        });
                        await searchBooks({ query: book.title, ctx });
                        let hiveBook = await ctx.db
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
                          return null;
                        }

                        if (book.isbn) {
                          const existingIdentifiers: BookIdentifiers =
                            hiveBook.identifiers
                              ? JSON.parse(hiveBook.identifiers)
                              : {};
                          const cleanIsbn = book.isbn.replace(/[-\s]/g, "");
                          const newIdentifiers: BookIdentifiers = {
                            ...existingIdentifiers,
                            hiveId: hiveBook.id,
                            ...(cleanIsbn.length === 13
                              ? { isbn13: cleanIsbn }
                              : cleanIsbn.length === 10
                                ? { isbn10: cleanIsbn }
                                : {}),
                          };
                          if (
                            newIdentifiers.isbn10 !==
                              existingIdentifiers.isbn10 ||
                            newIdentifiers.isbn13 !==
                              existingIdentifiers.isbn13 ||
                            !existingIdentifiers.hiveId
                          ) {
                            await ctx.db
                              .updateTable("hive_book")
                              .set({
                                identifiers: JSON.stringify(newIdentifiers),
                              })
                              .where("id", "=", hiveBook.id)
                              .execute();
                          }
                        }

                        let status = "buzz.bookhive.defs#wantToRead";
                        switch (book.readStatus?.toLowerCase()) {
                          case "read":
                            status = "buzz.bookhive.defs#finished";
                            break;
                          case "currently-reading":
                            status = "buzz.bookhive.defs#reading";
                            break;
                          default:
                            break;
                        }

                        const existingHiveIds = await existingHiveIdsPromise;
                        return [
                          hiveBook.id as HiveId,
                          {
                            authors: book.authors,
                            title: hiveBook.title,
                            status,
                            hiveId: hiveBook.id,
                            coverImage: hiveBook.cover ?? undefined,
                            finishedAt:
                              book.lastDateRead?.toISOString() ?? undefined,
                            stars: book.starRating
                              ? parseInt(String(book.starRating * 2))
                              : undefined,
                            review: book.review || undefined,
                            alreadyExists: existingHiveIds.has(hiveBook.id),
                          },
                        ] as const;
                      } catch (e) {
                        ctx.logger.error(
                          { error: e, book },
                          "Failed to update book record",
                        );
                        unmatchedBooks.push({
                          book,
                          reason: "processing_error",
                        });
                        return null;
                      }
                    }),
                  )
                ).filter((a) => a !== null),
              );
            },
          ),
        )
        .pipeTo(
          new WritableStream({
            async write(bookUpdates) {
              const startProcessed = matchedBooks;
              let idx = 0;
              for (const book of bookUpdates.values()) {
                const processed = startProcessed + ++idx;
                await stream.writeSSE({
                  data: JSON.stringify({
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
                    id: id++,
                  }),
                });
                if (
                  book &&
                  !(book as { alreadyExists?: boolean })["alreadyExists"]
                ) {
                  uploadedBooks++;
                }
              }
              matchedBooks += bookUpdates.size;

              try {
                await updateBookRecords({
                  ctx,
                  agent,
                  updates: bookUpdates,
                  bookRecords,
                });
              } catch (error) {
                ctx.logger.error(
                  { error, bookCount: bookUpdates.size },
                  "Failed to update book records in batch, trying individually",
                );
                let individualSuccesses = 0;
                let individualFailures = 0;
                for (const [hiveId, bookUpdate] of bookUpdates.entries()) {
                  try {
                    await updateBookRecord({
                      ctx,
                      agent,
                      hiveId,
                      updates: bookUpdate,
                    });
                    individualSuccesses++;
                    if (
                      !(bookUpdate as { alreadyExists?: boolean })[
                        "alreadyExists"
                      ]
                    ) {
                      uploadedBooks++;
                    }
                  } catch (individualError) {
                    individualFailures++;
                    ctx.logger.error(
                      {
                        error: individualError,
                        hiveId,
                        bookUpdate: bookUpdate as Record<string, unknown>,
                      },
                      "Failed to update individual book record",
                    );
                    unmatchedBooks.push({
                      book: {
                        title: bookUpdate.title || "Unknown",
                        authors: bookUpdate.authors || "Unknown",
                        contributors: "",
                        isbn: "",
                        format: "",
                        readStatus: "",
                        dateAdded: null,
                        lastDateRead: bookUpdate.finishedAt
                          ? new Date(bookUpdate.finishedAt)
                          : null,
                        datesRead: "",
                        readCount: 0,
                        moods: "",
                        pace: "",
                        characterOrPlot: "",
                        strongCharacterDevelopment: "",
                        loveableCharacters: "",
                        diverseCharacters: "",
                        flawedCharacters: "",
                        starRating: bookUpdate.stars ? bookUpdate.stars / 2 : 0,
                        review: bookUpdate.review || "",
                        contentWarnings: "",
                        contentWarningDescription: "",
                        tags: "",
                        owned: false,
                      } as StorygraphBook,
                      reason: "update_error",
                    });
                  }
                }
                if (individualFailures > 0) {
                  await stream.writeSSE({
                    data: JSON.stringify({
                      event: "import-error",
                      stage: "uploading",
                      stageProgress: {
                        current: matchedBooks,
                        total: totalBooks,
                        message: `Individual save completed: ${individualSuccesses} succeeded, ${individualFailures} failed`,
                      },
                      error: `Individual save: ${individualSuccesses} succeeded, ${individualFailures} failed`,
                      id: id++,
                    }),
                  });
                }
              }
            },
          }),
        );

      await stream.writeSSE({
        data: JSON.stringify({
          event: "import-complete",
          stage: "complete",
          stageProgress: {
            current: matchedBooks,
            total: totalBooks,
            message: `Import complete! Successfully imported ${uploadedBooks} books${unmatchedBooks.length > 0 ? ` (${unmatchedBooks.length} failed)` : ""}`,
          },
          failedBooks: Array.from(
            new Map(
              unmatchedBooks.map((b) => [
                `${normalizeStr(b.book.title)}::${normalizeStr(b.book.authors)}`,
                { title: b.book.title, author: b.book.authors },
              ]),
            ).values(),
          ),
          failedBookDetails: unmatchedBooks.map((b) => ({
            title: b.book.title,
            author: b.book.authors,
            isbn13: b.book.isbn || undefined,
            stars: b.book.starRating ? b.book.starRating * 2 : undefined,
            review: b.book.review || undefined,
            finishedAt: b.book.lastDateRead
              ? b.book.lastDateRead.toISOString()
              : undefined,
            status:
              b.book.readStatus?.toLowerCase() === "read"
                ? "buzz.bookhive.defs#finished"
                : b.book.readStatus?.toLowerCase() === "currently-reading"
                  ? "buzz.bookhive.defs#reading"
                  : undefined,
            reason: b.reason,
          })),
          id: id++,
        }),
      });
    });
  },
);

export default importApp;
