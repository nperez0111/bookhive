/**
 * XRPC router: mounts the four BookHive query methods at /xrpc/*
 * Handlers are registered as addQuery-style routes; pass app and deps from createRouter.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { ids } from "../bsky/lexicon";
import type {
  GetBookIdentifiersOutputSchema,
  GetBookOutputSchema,
  GetProfileOutputSchema,
} from "../bsky/lexicon/output-schemas";
import {
  findBookIdentifiersByLookup,
  findHiveBookByBookIdentifiersLookup,
  transformBookWithIdentifiers,
} from "../bsky/bookLookup";
import { BOOK_STATUS_MAP } from "../constants";
import { BookFields } from "../db";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { hydrateUserBook } from "../utils/bookProgress";
import {
  deriveBookIdentifiers,
  normalizeGoodreadsId,
  normalizeHiveId,
  normalizeIsbn,
  normalizeIsbn13,
  toBookIdentifiersOutput,
} from "../utils/bookIdentifiers";
import type { NotNull } from "kysely";
import type { Logger } from "pino";
import type { Storage } from "unstorage";
import type { SessionClient } from "../auth/client";
import type { BookIdentifiers, HiveBook, ProfileViewDetailed } from "../types";

/** Minimal context shape required by XRPC handlers (avoids importing index). */
export type XrpcContext = {
  db: Database;
  kv: Storage;
  resolver: {
    resolveDidsToHandles: (dids: string[]) => Promise<Record<string, string>>;
  };
  getSessionAgent: () => Promise<SessionClient | null>;
  baseIdResolver: {
    handle: { resolve: (handle: string) => Promise<string | undefined> };
  };
  logger: Logger;
};

export type XrpcDeps<E extends XrpcContext = XrpcContext> = {
  searchBooks: (opts: {
    query: string;
    ctx: Pick<E, "db" | "kv" | "logger">;
  }) => Promise<HiveId[]>;
  ensureBookIdentifiersCurrent: (opts: {
    ctx: E;
    book: HiveBook;
  }) => Promise<void>;
  getProfile: (opts: {
    ctx: E;
    did: string;
  }) => Promise<ProfileViewDetailed | null>;
};

export function createXrpcRouter<
  E extends XrpcContext,
  V extends { ctx: E } = { ctx: E },
>(app: Hono<{ Variables: V }>, deps: XrpcDeps<E>): void {
  const xrpcApp = new Hono<{ Variables: V }>();

  // buzz.bookhive.searchBooks
  xrpcApp.get(
    "/" + ids.BuzzBookhiveSearchBooks,
    zValidator(
      "query",
      z.object({
        q: z.string(),
        limit: z.coerce.number().default(25),
        offset: z.coerce.number().optional().default(0),
        id: z.string().optional(),
      }),
    ),
    async (c) => {
      const { q, limit, offset, id } = c.req.valid("query");
      const ctx = c.get("ctx");

      if (id) {
        const book = await ctx.db
          .selectFrom("hive_book")
          .selectAll()
          .where("hive_book.id", "=", id as HiveId)
          .limit(1)
          .executeTakeFirst();

        return c.json(
          [book]
            .filter((a) => a !== undefined)
            .map(transformBookWithIdentifiers),
        );
      }

      const bookIds = await deps.searchBooks({ query: q, ctx });

      if (!bookIds.length) {
        return c.json([]);
      }

      const books = await ctx.db
        .selectFrom("hive_book")
        .selectAll()
        .where("id", "in", bookIds)
        .limit(limit * offset + limit)
        .execute();

      books.sort((a, b) => bookIds.indexOf(a.id) - bookIds.indexOf(b.id));

      return c.json(
        books.slice(offset, offset + limit).map(transformBookWithIdentifiers),
      );
    },
  );

  // buzz.bookhive.getBookIdentifiers
  xrpcApp.get(
    "/" + ids.BuzzBookhiveGetBookIdentifiers,
    zValidator(
      "query",
      z
        .object({
          hiveId: z.string().optional(),
          isbn: z.string().optional(),
          isbn13: z.string().optional(),
          goodreadsId: z.string().optional(),
        })
        .refine(
          ({ hiveId, isbn, isbn13, goodreadsId }) =>
            Boolean(hiveId || isbn || isbn13 || goodreadsId),
          {
            message:
              "At least one identifier is required: hiveId, isbn, isbn13, or goodreadsId",
          },
        ),
    ),
    async (c) => {
      const ctx = c.get("ctx");
      const query = c.req.valid("query");

      const hiveId = normalizeHiveId(query.hiveId);
      const isbn = normalizeIsbn(query.isbn);
      const isbn13 = normalizeIsbn13(query.isbn13);
      const goodreadsId = normalizeGoodreadsId(query.goodreadsId);

      if (!hiveId && !isbn && !isbn13 && !goodreadsId) {
        return c.json(
          {
            success: false,
            message:
              "Invalid identifier. Provide hiveId, isbn, isbn13, or goodreadsId.",
          },
          400,
        );
      }

      let bookIdentifiersRow = await findBookIdentifiersByLookup({
        ctx,
        hiveId,
        isbn,
        isbn13,
        goodreadsId,
      });

      let hiveBook: HiveBook | undefined;
      if (bookIdentifiersRow) {
        hiveBook = await ctx.db
          .selectFrom("hive_book")
          .selectAll()
          .where("id", "=", bookIdentifiersRow.hiveId)
          .executeTakeFirst();
      } else {
        hiveBook = await findHiveBookByBookIdentifiersLookup({
          ctx,
          hiveId,
          isbn,
          isbn13,
          goodreadsId,
        });
      }

      if (!bookIdentifiersRow && !hiveBook) {
        return c.json({ success: false, message: "Book not found" }, 404);
      }

      if (hiveBook) {
        await deps.ensureBookIdentifiersCurrent({
          ctx: ctx as unknown as E,
          book: hiveBook,
        });
        bookIdentifiersRow = await ctx.db
          .selectFrom("book_id_map")
          .selectAll()
          .where("hiveId", "=", hiveBook.id)
          .executeTakeFirst();
      }

      if (!bookIdentifiersRow) {
        if (!hiveBook) {
          return c.json({ success: false, message: "Book not found" }, 404);
        }
        const response = {
          bookIdentifiers: toBookIdentifiersOutput(
            deriveBookIdentifiers(hiveBook),
          ),
        } satisfies GetBookIdentifiersOutputSchema;
        return c.json(response);
      }

      const response = {
        bookIdentifiers: toBookIdentifiersOutput(bookIdentifiersRow),
      } satisfies GetBookIdentifiersOutputSchema;
      return c.json(response);
    },
  );

  // buzz.bookhive.getBook
  xrpcApp.get(
    "/" + ids.BuzzBookhiveGetBook,
    zValidator(
      "query",
      z.object({
        id: z.string().optional(),
        isbn: z.string().optional(),
        isbn13: z.string().optional(),
        goodreadsId: z.string().optional(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      const { id, isbn, isbn13, goodreadsId } = c.req.valid("query");
      let hiveId = id as HiveId | undefined;
      const ctx = c.get("ctx");

      if (!id) {
        hiveId = (
          await findBookIdentifiersByLookup({
            ctx,
            isbn,
            isbn13,
            goodreadsId,
          })
        )?.hiveId;
      }

      if (!hiveId) {
        return c.json({ success: false, message: "Book not found" }, 400);
      }

      const book = await ctx.db
        .selectFrom("hive_book")
        .selectAll()
        .where("hive_book.id", "=", hiveId)
        .limit(1)
        .executeTakeFirst();

      if (!book) {
        return c.json({ success: false, message: "Book not found" }, 404);
      }

      const comments = await ctx.db
        .selectFrom("buzz")
        .select([
          "buzz.bookUri",
          "buzz.bookCid",
          "buzz.comment",
          "buzz.createdAt",
          "buzz.userDid",
          "buzz.parentUri",
          "buzz.parentCid",
          "buzz.cid",
          "buzz.uri",
        ])
        .where("buzz.hiveId", "=", book.id)
        .orderBy("buzz.createdAt", "desc")
        .limit(3000)
        .execute();

      const topLevelReviews = await ctx.db
        .selectFrom("user_book")
        .select([
          "user_book.review as comment",
          "user_book.createdAt",
          "user_book.stars",
          "user_book.userDid",
          "user_book.uri",
          "user_book.cid",
        ])
        .where("user_book.hiveId", "=", book.id)
        .where("user_book.review", "is not", null)
        .$narrowType<{ comment: NotNull }>()
        .orderBy("user_book.createdAt", "desc")
        .limit(1000)
        .execute();

      const rawUserBook = agent
        ? await ctx.db
            .selectFrom("user_book")
            .selectAll()
            .where("user_book.hiveId", "=", book.id)
            .where("user_book.userDid", "=", agent.did)
            .executeTakeFirst()
        : null;
      const userBook = rawUserBook ? hydrateUserBook(rawUserBook) : null;

      const peerBooks = await ctx.db
        .selectFrom("user_book")
        .selectAll()
        .where("hiveId", "==", book.id)
        .orderBy("indexedAt", "desc")
        .limit(100)
        .execute();

      const didToHandle = await ctx.resolver.resolveDidsToHandles(
        Array.from(
          new Set(
            comments
              .map((c) => c.userDid)
              .concat(topLevelReviews.map((r) => r.userDid))
              .concat(peerBooks.map((b) => b.userDid)),
          ),
        ),
      );

      const response = {
        createdAt: userBook?.createdAt,
        startedAt: userBook?.startedAt ?? undefined,
        finishedAt: userBook?.finishedAt ?? undefined,
        status: userBook?.status ?? undefined,
        stars: userBook?.stars ?? undefined,
        review: userBook?.review ?? undefined,
        bookProgress: userBook?.bookProgress ?? undefined,
        userBookUri: userBook?.uri ?? undefined,
        userBookCid: userBook?.cid ?? undefined,
        book: {
          $type: "buzz.bookhive.hiveBook",
          id: book.id,
          title: book.title,
          authors: book.authors,
          cover: book.cover ?? undefined,
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
          rating: book.rating ?? undefined,
          ratingsCount: book.ratingsCount ?? undefined,
          thumbnail: book.thumbnail ?? undefined,
          description: book.description ?? undefined,
          source: book.source ?? undefined,
          sourceId: book.sourceId ?? undefined,
          sourceUrl: book.sourceUrl ?? undefined,
          identifiers: {
            hiveId: book.id,
            ...(book.identifiers
              ? (JSON.parse(book.identifiers) as BookIdentifiers)
              : toBookIdentifiersOutput(
                  await findBookIdentifiersByLookup({
                    ctx,
                    hiveId: book.id,
                  }),
                )),
          },
        },
        comments: comments.map((c) => ({
          book: { cid: c.bookCid, uri: c.bookUri },
          comment: c.comment,
          createdAt: c.createdAt,
          did: c.userDid,
          handle: didToHandle[c.userDid] ?? c.userDid,
          uri: c.uri,
          cid: c.cid,
          parent: { uri: c.parentUri, cid: c.parentCid },
        })) as GetBookOutputSchema["comments"],
        reviews: topLevelReviews.map((r) => ({
          createdAt: r.createdAt,
          did: r.userDid,
          handle: didToHandle[r.userDid] ?? r.userDid,
          review: r.comment,
          stars: r.stars ?? undefined,
          uri: r.uri,
          cid: r.cid,
        })),
        activity: peerBooks.map((b) => ({
          type:
            b.status &&
            b.status in BOOK_STATUS_MAP &&
            BOOK_STATUS_MAP[b.status as keyof typeof BOOK_STATUS_MAP] === "read"
              ? "finished"
              : b.review
                ? "review"
                : "started",
          createdAt: b.createdAt,
          hiveId: b.hiveId,
          title: b.title,
          userDid: b.userDid,
          userHandle: didToHandle[b.userDid] ?? b.userDid,
        })),
      } satisfies GetBookOutputSchema & {
        userBookUri?: string;
        userBookCid?: string;
      };

      return c.json(response);
    },
  );

  // buzz.bookhive.getProfile
  xrpcApp.get(
    "/" + ids.BuzzBookhiveGetProfile,
    zValidator(
      "query",
      z.object({
        did: z.string().optional(),
        handle: z.string().optional(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      let { did, handle } = c.req.valid("query");
      const ctx = c.get("ctx");

      if (!did && !handle) {
        if (!agent) {
          return c.json(
            {
              success: false,
              message: "No did or handle specified, and no session",
            },
            401,
          );
        }
        did = agent.did;
      }

      if (handle && !did) {
        did = await ctx.baseIdResolver.handle.resolve(handle);
      }

      if (!did) {
        return c.json({ success: false, message: "User not found" }, 404);
      }

      const books = await ctx.db
        .selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .select(BookFields)
        .where("user_book.userDid", "=", did)
        .orderBy("user_book.createdAt", "desc")
        .limit(1000)
        .execute();
      const profile = await deps.getProfile({
        ctx: ctx as unknown as E,
        did,
      });
      const friendsBuzzes = await ctx.db
        .selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .innerJoin(
          "user_follows",
          "user_book.userDid",
          "user_follows.followsDid",
        )
        .select(BookFields)
        .where("user_follows.userDid", "=", did)
        .where("user_follows.isActive", "=", 1)
        .orderBy("user_book.createdAt", "desc")
        .limit(50)
        .execute();
      const parsedBooks = books.map((book) => hydrateUserBook(book));
      const parsedFriendsBuzzes = friendsBuzzes.map((book) =>
        hydrateUserBook(book),
      );

      const didToHandle = await ctx.resolver.resolveDidsToHandles(
        Array.from(
          new Set(
            books
              .map((c) => c.userDid)
              .concat(friendsBuzzes.map((r) => r.userDid)),
          ),
        ),
      );

      const isFollowing =
        agent && agent.did !== did
          ? Boolean(
              await ctx.db
                .selectFrom("user_follows")
                .select(["followsDid"])
                .where("userDid", "=", agent.did)
                .where("followsDid", "=", did)
                .where("isActive", "=", 1)
                .executeTakeFirst(),
            )
          : undefined;

      const response = {
        profile: {
          displayName: profile?.displayName ?? profile?.handle ?? did,
          avatar: profile?.avatar,
          handle: profile?.handle ?? did,
          description: profile?.description,
          booksRead: books.filter(
            (b) =>
              b.status &&
              b.status in BOOK_STATUS_MAP &&
              BOOK_STATUS_MAP[b.status as keyof typeof BOOK_STATUS_MAP] ===
                "read",
          ).length,
          reviews: books.filter((b) => b.review).length,
          isFollowing,
        },
        friendActivity: parsedFriendsBuzzes.map((b) => ({
          userDid: b.userDid,
          userHandle: didToHandle[b.userDid] ?? b.userDid,
          authors: b.authors,
          createdAt: b.createdAt,
          hiveId: b.hiveId,
          title: b.title,
          thumbnail: b.thumbnail || "",
          cover: b.cover ?? b.thumbnail ?? undefined,
          finishedAt: b.finishedAt ?? undefined,
          review: b.review ?? undefined,
          stars: b.stars ?? undefined,
          status: b.status ?? undefined,
          description: b.description ?? undefined,
          rating: b.rating ?? undefined,
          startedAt: b.startedAt ?? undefined,
          bookProgress: b.bookProgress ?? undefined,
        })),
        books: parsedBooks.map((b) => ({
          userDid: b.userDid,
          userHandle: didToHandle[b.userDid] ?? b.userDid,
          authors: b.authors,
          createdAt: b.createdAt,
          hiveId: b.hiveId,
          title: b.title,
          thumbnail: b.thumbnail || "",
          cover: b.cover ?? b.thumbnail ?? undefined,
          finishedAt: b.finishedAt ?? undefined,
          review: b.review ?? undefined,
          stars: b.stars ?? undefined,
          status: b.status ?? undefined,
          description: b.description ?? undefined,
          rating: b.rating ?? undefined,
          startedAt: b.startedAt ?? undefined,
          bookProgress: b.bookProgress ?? undefined,
        })),
        activity: books
          .reduce(
            (acc, b) => {
              const existing = acc.find((a) => a.hiveId === b.hiveId);
              if (
                !existing ||
                new Date(b.createdAt) > new Date(existing.createdAt)
              ) {
                if (existing) {
                  acc.splice(acc.indexOf(existing), 1);
                }
                acc.push({
                  type:
                    b.status &&
                    b.status in BOOK_STATUS_MAP &&
                    BOOK_STATUS_MAP[
                      b.status as keyof typeof BOOK_STATUS_MAP
                    ] === "read"
                      ? "finished"
                      : b.review
                        ? "review"
                        : "started",
                  createdAt: b.createdAt,
                  hiveId: b.hiveId,
                  title: b.title,
                  userDid: b.userDid,
                  userHandle: didToHandle[b.userDid] ?? b.userDid,
                });
              }
              return acc;
            },
            [] as Array<{
              type: string;
              createdAt: string;
              hiveId: string;
              title: string;
              userDid: string;
              userHandle: string;
            }>,
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, 15),
      } satisfies GetProfileOutputSchema;

      return c.json(response);
    },
  );

  app.route("/xrpc", xrpcApp);
}
