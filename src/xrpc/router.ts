/**
 * XRPC router: mounts the four BookHive query methods at /xrpc/*
 * Uses @atcute/xrpc-server; context is passed via AsyncLocalStorage from Hono.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { XRPCRouter, json, XRPCError, AuthRequiredError } from "@atcute/xrpc-server";
import {
  BuzzBookhiveSearchBooks,
  BuzzBookhiveListGenres,
  BuzzBookhiveGetBookIdentifiers,
  BuzzBookhiveGetBook,
  BuzzBookhiveGetProfile,
  BuzzBookhiveGetExplore,
  BuzzBookhiveGetFeed,
  BuzzBookhiveGetAuthorBooks,
  BuzzBookhiveGetReadingStats,
  BuzzBookhiveGetList,
  BuzzBookhiveGetUserLists,
  BuzzBookhiveCreateList,
  BuzzBookhiveUpdateList,
  BuzzBookhiveDeleteList,
  BuzzBookhiveAddToList,
  BuzzBookhiveRemoveFromList,
  BuzzBookhiveReorderList,
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
import { loadGenresForHiveBook, loadGenresMapForHiveBooks } from "../utils/hiveBookGenres.js";
import { getTopAuthors } from "../pages/authorDirectory";
import {
  computeReadingStats,
  filterFinishedBooksByYear,
  filterFinishedBooksAllTime,
} from "../utils/readingStats";
import {
  deriveBookIdentifiers,
  normalizeGoodreadsId,
  normalizeHiveId,
  normalizeIsbn,
  normalizeIsbn13,
  toBookIdentifiersOutput,
} from "../utils/bookIdentifiers";
import { sql, type NotNull, type SqlBool } from "kysely";
import {
  createList,
  updateList,
  deleteList,
  addBookToList,
  removeBookFromList,
  reorderListItems,
  getListWithItems,
  getUserLists,
} from "../utils/lists";
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
  ensureBookIdentifiersCurrent: (opts: { ctx: E; book: HiveBook }) => Promise<void>;
  getProfile: (opts: { ctx: E; did: string }) => Promise<ProfileViewDetailed | null>;
};

const xrpcContextStorage = new AsyncLocalStorage<XrpcContext>();

function getCtx(): XrpcContext {
  const ctx = xrpcContextStorage.getStore();
  if (!ctx) throw new Error("XRPC context not set (missing AsyncLocalStorage.run)");
  return ctx;
}

export function createXrpcRouter<E extends XrpcContext, V extends { ctx: E } = { ctx: E }>(
  app: import("hono").Hono<{ Variables: V }>,
  deps: XrpcDeps<E>,
): void {
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

        const books = [book].filter((a): a is HiveBook => a !== undefined);
        const genreMap =
          books.length > 0
            ? await loadGenresMapForHiveBooks(
                ctx.db,
                books.map((b) => b.id),
              )
            : new Map();
        return json({
          books: books.map((b) => transformBookWithIdentifiers(b, genreMap.get(b.id))),
        });
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

        const genreMap = await loadGenresMapForHiveBooks(
          ctx.db,
          books.map((b) => b.id),
        );
        return json({
          books: books.map((b) => transformBookWithIdentifiers(b, genreMap.get(b.id))),
          offset: off + books.length,
        });
      }

      if (q === undefined || q === "") {
        return json({ books: [] });
      }

      const bookIds = await deps.searchBooks({ query: q, ctx });

      // For limits beyond the cached 20, backfill live with ILIKE
      let allIds = bookIds;
      if (limit > 20 && bookIds.length < limit) {
        const pattern = `%${q}%`;
        let extraQuery = ctx.db
          .selectFrom("hive_book")
          .select("id")
          .where((eb) => eb.or([eb("rawTitle", "like", pattern), eb("authors", "like", pattern)]))
          .orderBy("ratingsCount", "desc")
          .orderBy("rating", "desc")
          .limit(limit - bookIds.length);

        if (bookIds.length > 0) {
          extraQuery = extraQuery.where("id", "not in", bookIds);
        }

        const extra = await extraQuery.execute();
        allIds = [...bookIds, ...extra.map((r) => r.id)];
      }

      if (!allIds.length) {
        return json({ books: [] });
      }

      const books = await ctx.db
        .selectFrom("hive_book")
        .selectAll()
        .where("id", "in", allIds)
        .limit(limit * off + limit)
        .execute();

      books.sort((a, b) => allIds.indexOf(a.id) - allIds.indexOf(b.id));

      const slice = books.slice(off, off + limit);
      const genreMap = await loadGenresMapForHiveBooks(
        ctx.db,
        slice.map((b) => b.id),
      );

      // Include current user's statuses if logged in
      const agent = await ctx.getSessionAgent();
      let userStatuses: Record<string, string> | undefined;
      if (agent && slice.length > 0) {
        const userBooks = await ctx.db
          .selectFrom("user_book")
          .select(["hiveId", "status"])
          .where("userDid", "=", agent.did)
          .where(
            "hiveId",
            "in",
            slice.map((b) => b.id),
          )
          .execute();
        userStatuses = Object.fromEntries(
          userBooks.filter((ub) => ub.status).map((ub) => [ub.hiveId, ub.status!]),
        );
      }

      return json({
        books: slice.map((b) => transformBookWithIdentifiers(b, genreMap.get(b.id))),
        offset: off + slice.length,
        userStatuses,
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
      const isbn10 = normalizeIsbn(params.isbn10);
      const isbn13 = normalizeIsbn13(params.isbn13);
      const goodreadsId = normalizeGoodreadsId(params.goodreadsId);

      if (!hiveId && !isbn10 && !isbn13 && !goodreadsId) {
        throw new XRPCError({
          status: 400,
          error: "InvalidRequest",
          description: "Invalid identifier. Provide hiveId, isbn, isbn13, or goodreadsId.",
        });
      }

      let bookIdentifiersRow = await findBookIdentifiersByLookup({
        ctx,
        hiveId,
        isbn10,
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
          isbn10,
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
          bookIdentifiers: toBookIdentifiersOutput(deriveBookIdentifiers(hiveBook)),
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
      const { id, isbn10, isbn13, goodreadsId } = params;
      let hiveId = id as HiveId | undefined;

      if (!id) {
        hiveId = (
          await findBookIdentifiersByLookup({
            ctx,
            isbn10,
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

      const [comments, bookGenres] = await Promise.all([
        ctx.db
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
          .execute(),
        loadGenresForHiveBook(ctx.db, book.id),
      ]);

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
            ...toBookIdentifiersOutput(await findBookIdentifiersByLookup({ ctx, hiveId: book.id })),
          };

      const response: GetBookOutputSchema & {
        userBookUri?: string;
        userBookCid?: string;
      } = {
        createdAt: userBook?.createdAt,
        startedAt: userBook?.startedAt ?? undefined,
        finishedAt: userBook?.finishedAt ?? undefined,
        status: userBook?.status ?? undefined,
        owned: userBook?.owned ? true : undefined,
        stars: userBook?.stars ?? undefined,
        review: userBook?.review ?? undefined,
        bookProgress: userBook?.bookProgress ?? undefined,
        userBookUri: userBook?.uri ?? undefined,
        userBookCid: userBook?.cid ?? undefined,
        book: toHiveBookOutput(book, bookIdentifiers, bookGenres),
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
        .innerJoin("user_follows", "user_book.userDid", "user_follows.followsDid")
        .select(BookFields)
        .where("user_follows.userDid", "=", did)
        .where("user_follows.isActive", "=", 1)
        .orderBy("user_book.createdAt", "desc")
        .limit(50)
        .execute();
      const parsedBooks = books.map((book) => hydrateUserBook(book));
      const parsedFriendsBuzzes = friendsBuzzes.map((book) => hydrateUserBook(book));

      const profileHiveIds = [
        ...new Set([...books.map((b) => b.hiveId), ...friendsBuzzes.map((b) => b.hiveId)]),
      ];
      const profileIdRows =
        profileHiveIds.length > 0
          ? await ctx.db
              .selectFrom("book_id_map")
              .where("hiveId", "in", profileHiveIds)
              .selectAll()
              .execute()
          : [];
      const identifiersByHiveId = new Map(
        profileIdRows.map((r) => [r.hiveId, toBookIdentifiersOutput(r)]),
      );

      const genresByHiveId = await loadGenresMapForHiveBooks(ctx.db, profileHiveIds as HiveId[]);

      const didToHandle = await ctx.resolver.resolveDidsToHandles(
        Array.from(
          new Set(books.map((c) => c.userDid).concat(friendsBuzzes.map((r) => r.userDid))),
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
              BOOK_STATUS_MAP[b.status as keyof typeof BOOK_STATUS_MAP] === "read",
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
          owned: b.owned ? true : undefined,
          description: b.description ?? undefined,
          rating: b.rating ?? undefined,
          startedAt: b.startedAt ?? undefined,
          bookProgress: b.bookProgress ?? undefined,
          identifiers: identifiersByHiveId.get(b.hiveId),
          genres: genresByHiveId.get(b.hiveId as HiveId),
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
          owned: b.owned ? true : undefined,
          description: b.description ?? undefined,
          rating: b.rating ?? undefined,
          startedAt: b.startedAt ?? undefined,
          bookProgress: b.bookProgress ?? undefined,
          identifiers: identifiersByHiveId.get(b.hiveId),
          genres: genresByHiveId.get(b.hiveId as HiveId),
        })),
        activity: books
          .reduce(
            (acc, b) => {
              const existing = acc.find((a) => a.hiveId === b.hiveId);
              if (!existing || new Date(b.createdAt) > new Date(existing.createdAt)) {
                if (existing) {
                  acc.splice(acc.indexOf(existing), 1);
                }
                acc.push({
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
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 15),
      };

      return json(response as unknown as GetProfileOutputSchema);
    },
  });

  router.addQuery(BuzzBookhiveGetExplore, {
    async handler() {
      const ctx = getCtx();

      const [genreRows, topAuthors] = await Promise.all([
        ctx.db
          .selectFrom("hive_book_genre")
          .select(["genre", sql<number>`COUNT(*)`.as("count")])
          .groupBy("genre")
          .orderBy(sql`COUNT(*)`, "desc")
          .limit(6)
          .execute(),
        getTopAuthors(ctx.db, 8),
      ]);

      return json({
        genres: genreRows.map((g) => ({ genre: g.genre, count: g.count })),
        topAuthors: topAuthors.map((a) => ({
          author: a.author,
          bookCount: a.bookCount,
          thumbnail: a.thumbnail ?? undefined,
          // avgRating from DB is already 0-5 (ROUND(AVG(...)/1000, 1)); scale by 10 for integer transport
          avgRating: a.avgRating != null ? Math.round(a.avgRating * 10) : undefined,
        })),
      });
    },
  });

  router.addQuery(BuzzBookhiveGetFeed, {
    async handler({ params }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();

      const tab = (params.tab as "friends" | "all" | "tracking") || "friends";
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(50, params.limit ?? 25);
      const offset = (page - 1) * limit;

      if ((tab === "friends" || tab === "tracking") && !agent) {
        throw new AuthRequiredError({
          description: `The ${tab} feed requires authentication`,
        });
      }

      let query = ctx.db
        .selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .select(BookFields)
        .orderBy("user_book.createdAt", "desc")
        .limit(limit + 1)
        .offset(offset);

      if (tab === "friends" && agent) {
        query = query.where(
          "user_book.userDid",
          "in",
          ctx.db
            .selectFrom("user_follows")
            .where("user_follows.userDid", "=", agent.did)
            .where("user_follows.isActive", "=", 1)
            .select("user_follows.followsDid"),
        ) as typeof query;
      } else if (tab === "tracking" && agent) {
        query = query.where(
          "user_book.hiveId",
          "in",
          ctx.db
            .selectFrom("user_book as ub2")
            .where("ub2.userDid", "=", agent.did)
            .select("ub2.hiveId"),
        ) as typeof query;
      }

      const rows = await query.execute();
      const hasMore = rows.length > limit;
      const activities = rows.slice(0, limit);

      const allDids = [...new Set(activities.map((a) => a.userDid))];
      const didToHandle =
        allDids.length > 0 ? await ctx.resolver.resolveDidsToHandles(allDids) : {};

      return json({
        activities: activities.map((a) => ({
          userDid: a.userDid,
          userHandle: didToHandle[a.userDid] ?? a.userDid,
          hiveId: a.hiveId,
          title: a.title,
          authors: a.authors,
          status: a.status ?? undefined,
          stars: a.stars ?? undefined,
          review: a.review ?? undefined,
          createdAt: a.createdAt,
          thumbnail: a.thumbnail || "",
          cover: a.cover ?? a.thumbnail ?? undefined,
        })),
        hasMore,
        page,
      });
    },
  });

  router.addQuery(BuzzBookhiveGetAuthorBooks, {
    async handler({ params }) {
      const ctx = getCtx();
      const { author, page = 1, limit = 50, sort = "popularity" } = params;

      const pageSize = Math.min(100, limit);
      const offset = (Math.max(1, page) - 1) * pageSize;

      // Build author matching condition (authors stored tab-separated)
      const exact = author;
      const first = `${author}\t%`;
      const middle = `%\t${author}\t%`;
      const last = `%\t${author}`;
      const authorCondition = sql`(
        authors = ${exact}
        OR authors LIKE ${first}
        OR authors LIKE ${middle}
        OR authors LIKE ${last}
      )`;

      const [totalCountResult, books] = await Promise.all([
        ctx.db
          .selectFrom("hive_book")
          .select(sql<number>`COUNT(*)`.as("count"))
          .where(authorCondition as any)
          .executeTakeFirst(),
        ctx.db
          .selectFrom("hive_book")
          .selectAll()
          .where(authorCondition as any)
          .orderBy(sort === "reviews" ? "rating" : "ratingsCount", "desc")
          .orderBy(sort === "reviews" ? "ratingsCount" : "rating", "desc")
          .limit(pageSize)
          .offset(offset)
          .execute(),
      ]);

      const totalBooks = Number(totalCountResult?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(totalBooks / pageSize));
      const genreMap = await loadGenresMapForHiveBooks(
        ctx.db,
        books.map((b) => b.id),
      );

      return json({
        author,
        books: books.map((b) => transformBookWithIdentifiers(b, genreMap.get(b.id))),
        totalBooks,
        totalPages,
        page: Math.max(1, page),
      });
    },
  });

  router.addQuery(BuzzBookhiveGetReadingStats, {
    async handler({ params }) {
      const ctx = getCtx();
      const { handle, year: yearParam } = params;
      const year = yearParam ?? new Date().getFullYear();

      // Resolve handle → DID
      let did: string | undefined;
      if (handle.startsWith("did:")) {
        did = handle;
      } else {
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
        .orderBy("user_book.indexedAt", "desc")
        .limit(10_000)
        .execute();
      const parsedBooks = books.map((b) => hydrateUserBook(b));

      const finishedInYear = filterFinishedBooksByYear(parsedBooks, year);

      let genreStatsForYear: { genre: string; count: number }[] = [];
      if (finishedInYear.length > 0) {
        const hiveIds = finishedInYear.map((b) => b.hiveId);
        const rows = await ctx.db
          .selectFrom("hive_book_genre")
          .select(["genre", sql<number>`COUNT(*)`.as("count")])
          .where("hiveId", "in", hiveIds)
          .groupBy("genre")
          .orderBy(sql`COUNT(*)`, "desc")
          .limit(15)
          .execute();
        genreStatsForYear = rows.map((r) => ({
          genre: r.genre,
          count: Number(r.count),
        }));
      }

      const stats = computeReadingStats(finishedInYear, genreStatsForYear);

      const finishedAllTime = filterFinishedBooksAllTime(parsedBooks);
      const yearSet = new Set(
        finishedAllTime
          .map((b) => (b.finishedAt ? new Date(b.finishedAt).getFullYear() : 0))
          .filter((y) => y >= 2000 && y <= 2100),
      );
      const currentYear = new Date().getFullYear();
      if (!yearSet.has(currentYear)) yearSet.add(currentYear);
      const availableYears = [...yearSet].sort((a, b) => b - a);

      const toBookSummary = (
        b: {
          hiveId: string;
          title: string;
          authors: string;
          cover?: string | null;
          thumbnail?: string | null;
          bookProgress?: { totalPages?: number | null } | null;
          rating?: number | null;
        } | null,
      ) => {
        if (!b) return undefined;
        return {
          hiveId: b.hiveId,
          title: b.title,
          authors: b.authors,
          cover: b.cover ?? b.thumbnail ?? undefined,
          thumbnail: b.thumbnail ?? undefined,
          pageCount: b.bookProgress?.totalPages ?? undefined,
          rating: b.rating ?? undefined,
        };
      };

      return json({
        stats: {
          booksCount: stats.booksCount,
          pagesRead: stats.pagesRead,
          averageRating:
            stats.averageRating != null ? Math.round(stats.averageRating * 10) : undefined,
          averagePageCount: stats.averagePageCount ?? undefined,
          ratingDistribution: {
            one: stats.ratingDistribution[1],
            two: stats.ratingDistribution[2],
            three: stats.ratingDistribution[3],
            four: stats.ratingDistribution[4],
            five: stats.ratingDistribution[5],
          },
          topGenres: stats.topGenres.slice(0, 5),
          shortestBook: toBookSummary(stats.shortestBook),
          longestBook: toBookSummary(stats.longestBook),
          firstBookOfYear: toBookSummary(stats.firstBookOfYear),
          lastBookOfYear: toBookSummary(stats.lastBookOfYear),
          mostPopularBook: toBookSummary(stats.mostPopularBook),
          leastPopularBook: toBookSummary(stats.leastPopularBook),
        },
        availableYears,
        year,
      });
    },
  });

  // ── List CRUD ──

  router.addProcedure(BuzzBookhiveCreateList, {
    async handler({ input }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      if (!agent) throw new AuthRequiredError({ description: "Authentication required" });

      const result = await createList({
        agent,
        db: ctx.db,
        name: input.name,
        description: input.description,
        ordered: input.ordered,
        tags: input.tags,
      });

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveUpdateList, {
    async handler({ input }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      if (!agent) throw new AuthRequiredError({ description: "Authentication required" });

      const result = await updateList({
        agent,
        db: ctx.db,
        uri: input.uri,
        name: input.name,
        description: input.description,
        ordered: input.ordered,
        tags: input.tags,
      });

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveDeleteList, {
    async handler({ input }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      if (!agent) throw new AuthRequiredError({ description: "Authentication required" });

      await deleteList({ agent, db: ctx.db, uri: input.uri });

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveAddToList, {
    async handler({ input }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      if (!agent) throw new AuthRequiredError({ description: "Authentication required" });

      const result = await addBookToList({
        agent,
        db: ctx.db,
        listUri: input.listUri,
        hiveId: input.hiveId as HiveId,
        description: input.description,
        position: input.position,
      });

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveRemoveFromList, {
    async handler({ input }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      if (!agent) throw new AuthRequiredError({ description: "Authentication required" });

      await removeBookFromList({ agent, db: ctx.db, itemUri: input.itemUri });

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveReorderList, {
    async handler({ input }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      if (!agent) throw new AuthRequiredError({ description: "Authentication required" });

      await reorderListItems({
        agent,
        db: ctx.db,
        listUri: input.listUri,
        itemUris: input.itemUris,
      });

      return json({});
    },
  });

  // ── GetUserLists query ──

  router.addQuery(BuzzBookhiveGetUserLists, {
    async handler({ params }) {
      const ctx = getCtx();
      const { did } = params;

      const lists = await getUserLists({ db: ctx.db, userDid: did });
      const dids = [...new Set(lists.map((l) => l.userDid))];
      const didToHandle = dids.length > 0 ? await ctx.resolver.resolveDidsToHandles(dids) : {};

      return json({
        lists: lists.map((list) => ({
          uri: list.uri,
          cid: list.cid,
          userDid: list.userDid,
          userHandle: didToHandle[list.userDid] ?? list.userDid,
          name: list.name,
          description: list.description ?? undefined,
          ordered: Boolean(list.ordered),
          tags: list.tags ? JSON.parse(list.tags) : undefined,
          createdAt: list.createdAt,
          itemCount: list.itemCount ?? 0,
        })),
      });
    },
  });

  // ── GetList query ──

  router.addQuery(BuzzBookhiveGetList, {
    async handler({ params }) {
      const ctx = getCtx();
      const { uri } = params;

      const data = await getListWithItems({ db: ctx.db, listUri: uri });
      if (!data) {
        throw new XRPCError({
          status: 404,
          error: "NotFound",
          description: "List not found",
        });
      }

      const { list, items } = data;

      const didToHandle = await ctx.resolver.resolveDidsToHandles([list.userDid]);

      return json({
        list: {
          uri: list.uri,
          cid: list.cid,
          userDid: list.userDid,
          userHandle: didToHandle[list.userDid] ?? list.userDid,
          name: list.name,
          description: list.description ?? undefined,
          ordered: Boolean(list.ordered),
          tags: list.tags ? JSON.parse(list.tags) : undefined,
          createdAt: list.createdAt,
          itemCount: items.length,
        },
        items: items.map((item) => ({
          uri: item.uri,
          hiveId: item.hiveId ?? undefined,
          description: item.description ?? undefined,
          position: item.position ?? undefined,
          addedAt: item.addedAt,
          // Use hive_book data when resolved, fall back to embedded metadata
          title: item.title ?? item.embeddedTitle ?? undefined,
          authors: item.authors ?? item.embeddedAuthor ?? undefined,
          thumbnail: item.thumbnail || item.embeddedCoverUrl || undefined,
          cover: item.cover ?? item.thumbnail ?? item.embeddedCoverUrl ?? undefined,
          rating: item.rating != null ? Math.round(item.rating * 10) : undefined,
        })),
      });
    },
  });

  app.all("/xrpc/*", (c) => xrpcContextStorage.run(c.get("ctx"), () => router.fetch(c.req.raw)));
}
