/**
 * XRPC router: mounts the four BookHive query methods at /xrpc/*
 * Uses @atcute/xrpc-server; context is passed via AsyncLocalStorage from Hono.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  XRPCRouter,
  json,
  XRPCError,
  AuthRequiredError,
} from "@atcute/xrpc-server";
import {
  BuzzBookhiveSearchBooks,
  BuzzBookhiveListGenres,
  BuzzBookhiveGetBookIdentifiers,
  BuzzBookhiveGetBook,
  BuzzBookhiveGetProfile,
} from "../bsky/lexicon/generated/index.js";
import type {
  GetBookIdentifiersOutputSchema,
  GetBookOutputSchema,
  GetProfileOutputSchema,
} from "../bsky/lexicon/output-schemas";
import {
  findBookIdentifiersByLookup,
  findHiveBookByBookIdentifiersLookup,
  toHiveBookOutput,
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
import { sql, type NotNull, type SqlBool } from "kysely";
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
  addWideEventContext: (context: Record<string, unknown>) => void;
};

export type XrpcDeps<E extends XrpcContext = XrpcContext> = {
  searchBooks: (opts: {
    query: string;
    ctx: Pick<E, "db" | "kv" | "addWideEventContext">;
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

const xrpcContextStorage = new AsyncLocalStorage<XrpcContext>();

function getCtx(): XrpcContext {
  const ctx = xrpcContextStorage.getStore();
  if (!ctx)
    throw new Error("XRPC context not set (missing AsyncLocalStorage.run)");
  return ctx;
}

export function createXrpcRouter<
  E extends XrpcContext,
  V extends { ctx: E } = { ctx: E },
>(app: import("hono").Hono<{ Variables: V }>, deps: XrpcDeps<E>): void {
  const router = new XRPCRouter();

  router.addQuery(BuzzBookhiveSearchBooks, {
    async handler({ params }) {
      const ctx = getCtx();
      const { q, genre, limit = 25, offset = 0, id } = params;

      if (id) {
        const book = await ctx.db
          .selectFrom("hive_book")
          .selectAll()
          .where("hive_book.id", "=", id as HiveId)
          .limit(1)
          .executeTakeFirst();

        const books = [book]
          .filter((a): a is HiveBook => a !== undefined)
          .map((b) => transformBookWithIdentifiers(b));
        return json({ books });
      }

      const off = offset ?? 0;

      if (genre !== undefined && genre !== "") {
        let genreQuery = ctx.db
          .selectFrom("hive_book_genre")
          .innerJoin("hive_book", "hive_book.id", "hive_book_genre.hiveId")
          .selectAll("hive_book")
          .where("hive_book_genre.genre", "=", genre);

        if (q !== undefined && q !== "") {
          const pattern = `%${q}%`;
          genreQuery = genreQuery.where((eb) =>
            eb.or([
              eb("hive_book.rawTitle", "like", pattern),
              eb("hive_book.authors", "like", pattern),
            ]),
          );
        }

        const books = await genreQuery
          .orderBy("hive_book.ratingsCount", "desc")
          .orderBy("hive_book.rating", "desc")
          .limit(limit)
          .offset(off)
          .execute();

        return json({
          books: books.map((b) => transformBookWithIdentifiers(b)),
          offset: off + books.length,
        });
      }

      if (q === undefined || q === "") {
        return json({ books: [] });
      }

      const bookIds = await deps.searchBooks({ query: q, ctx });

      if (!bookIds.length) {
        return json({ books: [] });
      }

      const books = await ctx.db
        .selectFrom("hive_book")
        .selectAll()
        .where("id", "in", bookIds)
        .limit(limit * off + limit)
        .execute();

      books.sort((a, b) => bookIds.indexOf(a.id) - bookIds.indexOf(b.id));

      const slice = books.slice(off, off + limit);
      return json({
        books: slice.map((b) => transformBookWithIdentifiers(b)),
        offset: off + slice.length,
      });
    },
  });

  router.addQuery(BuzzBookhiveListGenres, {
    async handler({ params }) {
      const ctx = getCtx();
      const { limit = 50, offset = 0, minBooks = 0 } = params;

      let query = ctx.db
        .selectFrom("hive_book_genre")
        .select(["genre", sql<number>`COUNT(*)`.as("count")])
        .groupBy("genre")
        .orderBy(sql`COUNT(*)`, "desc");

      if (minBooks > 0) {
        query = query.having(sql<SqlBool>`COUNT(*) >= ${minBooks}`);
      }

      const genres = await query
        .limit(limit)
        .offset(offset ?? 0)
        .execute();

      return json({
        genres: genres.map((g) => ({ genre: g.genre, count: g.count })),
        offset: (offset ?? 0) + genres.length,
      });
    },
  });

  router.addQuery(BuzzBookhiveGetBookIdentifiers, {
    async handler({ params }) {
      const ctx = getCtx();
      const hiveId = normalizeHiveId(params.hiveId);
      const isbn = normalizeIsbn(params.isbn);
      const isbn13 = normalizeIsbn13(params.isbn13);
      const goodreadsId = normalizeGoodreadsId(params.goodreadsId);

      if (!hiveId && !isbn && !isbn13 && !goodreadsId) {
        throw new XRPCError({
          status: 400,
          error: "InvalidRequest",
          description:
            "Invalid identifier. Provide hiveId, isbn, isbn13, or goodreadsId.",
        });
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
        throw new XRPCError({
          status: 404,
          error: "NotFound",
          description: "Book not found",
        });
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
          throw new XRPCError({
            status: 404,
            error: "NotFound",
            description: "Book not found",
          });
        }
        const response: GetBookIdentifiersOutputSchema = {
          bookIdentifiers: toBookIdentifiersOutput(
            deriveBookIdentifiers(hiveBook),
          ),
        };
        return json(response);
      }

      const response: GetBookIdentifiersOutputSchema = {
        bookIdentifiers: toBookIdentifiersOutput(bookIdentifiersRow),
      };
      return json(response);
    },
  });

  router.addQuery(BuzzBookhiveGetBook, {
    async handler({ params }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      const { id, isbn, isbn13, goodreadsId } = params;
      let hiveId = id as HiveId | undefined;

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
        throw new XRPCError({
          status: 400,
          error: "InvalidRequest",
          description: "Book not found",
        });
      }

      const book = await ctx.db
        .selectFrom("hive_book")
        .selectAll()
        .where("hive_book.id", "=", hiveId)
        .limit(1)
        .executeTakeFirst();

      if (!book) {
        throw new XRPCError({
          status: 404,
          error: "NotFound",
          description: "Book not found",
        });
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

      const bookIdentifiers: BookIdentifiers = book.identifiers
        ? {
            hiveId: book.id,
            ...(JSON.parse(book.identifiers) as BookIdentifiers),
          }
        : {
            hiveId: book.id,
            ...toBookIdentifiersOutput(
              await findBookIdentifiersByLookup({ ctx, hiveId: book.id }),
            ),
          };

      const response: GetBookOutputSchema & {
        userBookUri?: string;
        userBookCid?: string;
      } = {
        createdAt: userBook?.createdAt,
        startedAt: userBook?.startedAt ?? undefined,
        finishedAt: userBook?.finishedAt ?? undefined,
        status: userBook?.status ?? undefined,
        stars: userBook?.stars ?? undefined,
        review: userBook?.review ?? undefined,
        bookProgress: userBook?.bookProgress ?? undefined,
        userBookUri: userBook?.uri ?? undefined,
        userBookCid: userBook?.cid ?? undefined,
        book: toHiveBookOutput(book, bookIdentifiers),
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
      };

      return json(response as never);
    },
  });

  router.addQuery(BuzzBookhiveGetProfile, {
    async handler({ params }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      let { did, handle } = params;

      if (!did && !handle) {
        if (!agent) {
          throw new AuthRequiredError({
            description: "No did or handle specified, and no session",
          });
        }
        did = agent.did;
      }

      if (handle && !did) {
        did = await ctx.baseIdResolver.handle.resolve(handle);
      }

      if (!did) {
        throw new XRPCError({
          status: 404,
          error: "NotFound",
          description: "User not found",
        });
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

      const response: GetProfileOutputSchema = {
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
      };

      return json(response as unknown as GetProfileOutputSchema);
    },
  });

  app.all("/xrpc/*", (c) =>
    xrpcContextStorage.run(c.get("ctx"), () => router.fetch(c.req.raw)),
  );
}
