/**
 * XRPC router: mounts BookHive query/procedure methods at /xrpc/*
 * Uses @atcute/xrpc-server; context is passed via AsyncLocalStorage from Hono.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  XRPCRouter,
  json,
  XRPCError,
  AuthRequiredError,
  InvalidRequestError,
} from "@atcute/xrpc-server";
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
  BuzzBookhiveGetLanguages,
  BuzzBookhiveGetPersonalLibrary,
  BuzzBookhiveGetPersonalBook,
  BuzzBookhiveGetPersonalBookFile,
  BuzzBookhiveGetPersonalBookCover,
  BuzzBookhiveListPersonalShelves,
  BuzzBookhiveUploadPersonalBook,
  BuzzBookhiveDeletePersonalBook,
  BuzzBookhiveLinkPersonalBook,
  BuzzBookhiveUnlinkPersonalBook,
  BuzzBookhiveCreatePersonalShelf,
  BuzzBookhiveUpdatePersonalShelf,
  BuzzBookhiveDeletePersonalShelf,
  BuzzBookhiveAddToPersonalShelf,
  BuzzBookhiveRemoveFromPersonalShelf,
  BuzzBookhiveGetSyncProgress,
  BuzzBookhivePutSyncProgress,
  BuzzBookhiveListSyncDocuments,
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
import { BOOK_STATUS } from "../constants";
import { BookFields } from "../db";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { hydrateUserBook } from "../core/bookProgress";
import { loadGenresForHiveBook, loadGenresMapForHiveBooks } from "../data/hiveBookGenres.js";
import { listBookActivity, listBookDiscussion } from "../data/bookDetail";
import { resolveActorDid } from "../services/actor";
import { getFeaturedAuthors } from "../data/authorStats";
import {
  DEFAULT_FEED_LIMIT,
  FEED_TABS,
  getActivityFeed,
  type FeedItem,
  type FeedTab,
} from "../data/activityFeed";
import { getTopGenres } from "../data/exploreGenres";
import { resolveLanguage } from "../data/getLanguages";
import { getAvailableLanguages } from "../data/getLanguages";
import { getReadingStatsForYear } from "../data/readingStats";
import { errorMessage, toErrorPayload } from "../lib/errors";
import {
  hydrateSearchResults,
  listBooksByAuthor,
  listBooksByGenre,
  searchLocalCatalog,
} from "../data/catalogBooks";
import {
  getPersonalBookRow,
  listPersonalBooks,
  personalBookView,
  shelfIdsForBooks,
  type PersonalBookSort,
} from "../data/personalBooks";
import { getSyncDocument, listSyncDocuments, syncProgressView } from "../data/syncDocuments";
import {
  deriveBookIdentifiers,
  normalizeGoodreadsId,
  normalizeHiveId,
  normalizeIsbn,
  normalizeIsbn13,
  toBookIdentifiersOutput,
} from "../data/bookIdentifiers";
import { sql } from "kysely";
import {
  createList,
  updateList,
  deleteList,
  addBookToList,
  removeBookFromList,
  reorderListItems,
  getListWithItems,
  getUserLists,
  type ListFailure,
} from "../services/lists";
import type { Storage } from "unstorage";
import type { SessionClient } from "../auth/client";
import type { BookIdentifiers, HiveBook, ProfileViewDetailed } from "../types";
import {
  etagMatches,
  getStorageQuota,
  getStorageUsage,
  removeBookDir,
  streamPersonalBook,
} from "../data/personalLibrary";
import { uploadPersonalBook, type UploadPersonalBookResult } from "../services/uploadPersonalBook";
import { resolveXrpcAuth, type AuthMode, type XrpcAuth, type XrpcAuthContext } from "./auth";
import type { Nsid } from "@atcute/lexicons";
import type { ServiceJwtVerifier } from "@atcute/xrpc-server/auth";
import { recordSyncProgress } from "../data/syncBridge";

/** Upload core failure reasons → XRPC errors; matching HTTP mapping lives in `src/routes/library.tsx`. */
/** List-write core refusal reasons → XRPC errors, so these procedures and `routes/shelves.tsx` can't drift. */
function listErrorFor(result: ListFailure): XRPCError {
  switch (result.reason) {
    case "not_found":
      return new XRPCError({ status: 404, error: "NotFound", message: result.message });
    case "not_owner":
      return new XRPCError({ status: 403, error: "Forbidden", message: result.message });
    case "book_not_found":
      return new XRPCError({ status: 404, error: "NotFound", message: result.message });
    case "pds_write_failed":
      return new XRPCError({ status: 502, error: "UpstreamFailure", message: result.message });
  }
}

function uploadErrorFor(result: Extract<UploadPersonalBookResult, { ok: false }>): XRPCError {
  switch (result.reason) {
    case "too-large":
      return new XRPCError({
        status: 413,
        error: "TooLarge",
        message: `File exceeds ${result.limitBytes} bytes`,
      });
    case "quota-exceeded":
      return new XRPCError({
        status: 413,
        error: "QuotaExceeded",
        message: `Library full (${result.usedBytes} of ${result.quotaBytes} bytes used)`,
      });
    case "unsupported-format":
      return new InvalidRequestError({
        message: `Unsupported file format: ${result.filename}`,
      });
    case "duplicate":
      return new XRPCError({
        status: 409,
        error: "AlreadyExists",
        message: "This book already exists in your library",
      });
    case "empty":
      return new InvalidRequestError({ message: "The file is empty" });
    case "busy":
      return new XRPCError({
        status: 503,
        error: "Busy",
        message: "Server is busy — try again in a moment",
      });
  }
}

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
  /** Verifies atproto service-auth JWTs. Null when service auth is disabled. */
  serviceJwtVerifier?: ServiceJwtVerifier | null;
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

// Same AsyncLocalStorage idiom as the context — atcute handlers only receive `{request, params, input, signal}`.
const xrpcAuthStorage = new AsyncLocalStorage<XrpcAuth>();

/** The authenticated caller. Only valid inside a handler registered with `auth`. */
function getAuth(): XrpcAuth {
  const auth = xrpcAuthStorage.getStore();
  if (!auth) throw new Error("XRPC auth not resolved (method registered without `auth`)");
  return auth;
}

// Non-null by construction — `auth: "pdsWrite"` refuses service auth before the handler runs.
function requireAgent(): SessionClient {
  const auth = getAuth();
  if (auth.method !== "session") {
    throw new AuthRequiredError({ message: "This method requires an OAuth session" });
  }
  return auth.agent;
}

export function createXrpcRouter<E extends XrpcContext, V extends { ctx: E } = { ctx: E }>(
  app: import("hono").Hono<{ Variables: V }>,
  deps: XrpcDeps<E>,
): void {
  const router = new XRPCRouter();

  // Two things are patched onto every registration here rather than repeated per handler:
  // 1. Error observability — XRPCRouter swallows handler throws into a 500 before Hono's error-capture middleware sees them.
  // 2. Authentication — the service-auth `lxm` binding is derived from the schema's own NSID, so it can't drift from the route.
  for (const method of ["addQuery", "addProcedure"] as const) {
    const original = router[method].bind(router) as (schema: unknown, options: any) => unknown;
    (router as any)[method] = (schema: any, options: any) => {
      const handler = options?.handler;
      if (typeof handler !== "function") return original(schema, options);

      // A generated lexicon module carries `mainSchema` — same NSID unwrap atcute does internally.
      const nsid = ("mainSchema" in schema ? schema.mainSchema : schema).nsid as Nsid;
      const mode: AuthMode | undefined = options.auth;
      const { auth: _auth, ...rest } = options;

      return original(schema, {
        ...rest,
        handler: async (input: any) => {
          try {
            if (mode === undefined) return await handler(input);

            const ctx = xrpcContextStorage.getStore();
            const auth = await resolveXrpcAuth(ctx as XrpcAuthContext, input.request, {
              lxm: nsid,
              mode,
            });
            ctx?.addWideEventContext({ userDid: auth.did, xrpc_auth: auth.method });
            // Auth failures land inside this try, so a 401 is recorded as intentional control flow, same as a hand-thrown one.
            return await xrpcAuthStorage.run(auth, () => handler(input));
          } catch (err) {
            // Deliberate 4xx (AuthRequiredError, InvalidRequest, …) are control flow, not defects — record without a stack.
            const status = (err as { status?: unknown } | null)?.status;
            const isIntentional = typeof status === "number" && status < 500;
            xrpcContextStorage.getStore()?.addWideEventContext({
              xrpc_handler: "threw",
              error: toErrorPayload(err, { stack: !isIntentional }),
            });
            throw err;
          }
        },
      });
    };
  }

  router.addQuery(BuzzBookhiveSearchBooks, {
    async handler({ params: _params }) {
      const ctx = getCtx();
      const params = _params as BuzzBookhiveSearchBooks.$params;
      const { q, genre, limit = 25, offset = 0, id, language } = params;

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
        // Same core as `/explore/genres/:genre`; this is a raw offset (not a
        // page number), as promised by the lexicon.
        const { books } = await listBooksByGenre({
          db: ctx.db,
          genre,
          page: Math.floor(off / limit) + 1,
          offset: off,
          pageSize: limit,
          sort: "popularity",
          language,
          q: q || undefined,
        });

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

      // Backfill from the local catalogue beyond the cached 20 — it searches a different column set than the FTS index.
      let allIds = bookIds;
      if (limit > 20 && bookIds.length < limit) {
        const extra = await searchLocalCatalog({
          db: ctx.db,
          q,
          limit: limit - bookIds.length,
          exclude: bookIds,
        });
        allIds = [...bookIds, ...extra];
      }

      if (!allIds.length) {
        return json({ books: [] });
      }

      // Same core as `/search` — hydrate before truncating, or the language sort could disagree with page one on iOS vs web.
      const books = await hydrateSearchResults({ db: ctx.db, ids: allIds, language });

      const slice = books.slice(off, off + limit);
      const genreMap = await loadGenresMapForHiveBooks(
        ctx.db,
        slice.map((b) => b.id),
      );

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
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { limit = 50, offset = 0, minBooks = 0 } = _params as BuzzBookhiveListGenres.$params;

      // `getTopGenres`'s `HAVING COUNT(*) > n` is `>=` here, hence the -1.
      // Offset slices the cached array rather than using SQL OFFSET, keeping order stable and KV cardinality bounded.
      const all = await getTopGenres(
        ctx.db,
        ctx.kv,
        offset + limit,
        undefined,
        minBooks > 0 ? minBooks - 1 : 0,
      );
      const genres = all.slice(offset, offset + limit);

      return json({
        genres: genres.map((g) => ({ genre: g.genre, count: g.count })),
        offset: offset + genres.length,
      });
    },
  });

  router.addQuery(BuzzBookhiveGetBookIdentifiers, {
    async handler({ params: _params }) {
      const ctx = getCtx();
      const params = _params as BuzzBookhiveGetBookIdentifiers.$params;
      const hiveId = normalizeHiveId(params.hiveId);
      const isbn10 = normalizeIsbn(params.isbn10);
      const isbn13 = normalizeIsbn13(params.isbn13);
      const goodreadsId = normalizeGoodreadsId(params.goodreadsId);

      if (!hiveId && !isbn10 && !isbn13 && !goodreadsId) {
        throw new XRPCError({
          status: 400,
          error: "InvalidRequest",
          message: "Invalid identifier. Provide hiveId, isbn, isbn13, or goodreadsId.",
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
          message: "Book not found",
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
            message: "Book not found",
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
    async handler({ params: _params }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      const { id, isbn10, isbn13, goodreadsId } = _params as BuzzBookhiveGetBook.$params;
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
          message: "Book not found",
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
          message: "Book not found",
        });
      }

      // Includes the `uri` keyset tiebreaker, without which two identical `getBook` calls could return different `peerBooks` sets.
      const [{ reviews: topLevelReviews, buzzes: comments }, bookGenres] = await Promise.all([
        listBookDiscussion({ db: ctx.db, hiveId: book.id }),
        loadGenresForHiveBook(ctx.db, book.id),
      ]);

      const rawUserBook = agent
        ? await ctx.db
            .selectFrom("user_book")
            .selectAll()
            .where("user_book.hiveId", "=", book.id)
            .where("user_book.userDid", "=", agent.did)
            .executeTakeFirst()
        : null;
      const userBook = rawUserBook ? hydrateUserBook(rawUserBook) : null;

      const { rows: peerBooks } = await listBookActivity({
        db: ctx.db,
        hiveId: book.id,
        limit: 100,
      });

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
        previousReads: userBook?.previousReads ?? undefined,
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
          type: b.status === BOOK_STATUS.FINISHED ? "finished" : b.review ? "review" : "started",
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
    async handler({ params: _params }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      let { did, handle } = _params as BuzzBookhiveGetProfile.$params;

      if (!did && !handle) {
        if (!agent) {
          throw new AuthRequiredError({
            message: "No did or handle specified, and no session",
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
          message: "User not found",
        });
      }

      // Ordered by `indexedAt`, matching `/profile/:handle` — `createdAt` is frozen at PDS-record creation.
      // Limit is 10_000 to match the web page; a smaller cap truncated a heavy user's library before `booksRead`/`reviews` were counted.
      const books = await ctx.db
        .selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .select(BookFields)
        .where("user_book.userDid", "=", did)
        .orderBy("user_book.indexedAt", "desc")
        .orderBy("user_book.uri", "desc")
        .limit(10_000)
        .execute();
      const profile = await deps.getProfile({
        ctx: ctx as unknown as E,
        did,
      });
      // Same key (`indexedAt`) — here it decides which 50 rows you see, not just their order.
      const friendsBuzzes = await ctx.db
        .selectFrom("user_book")
        .leftJoin("hive_book", "user_book.hiveId", "hive_book.id")
        .innerJoin("user_follows", "user_book.userDid", "user_follows.followsDid")
        .select(BookFields)
        .where("user_follows.userDid", "=", did)
        .where("user_follows.isActive", "=", 1)
        .orderBy("user_book.indexedAt", "desc")
        .orderBy("user_book.uri", "desc")
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

      // `activityView` puts `indexedAt` into the `createdAt` field on purpose — the field name lags the data pending a lexicon change.
      const bookView = (b: (typeof parsedBooks)[number], reportedAt: string) => ({
        userDid: b.userDid,
        userHandle: didToHandle[b.userDid] ?? b.userDid,
        authors: b.authors,
        createdAt: reportedAt,
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
        previousReads: b.previousReads ?? undefined,
        identifiers: identifiersByHiveId.get(b.hiveId),
        genres: genresByHiveId.get(b.hiveId as HiveId),
      });

      // Two named views, not a boolean flag — `.map(bookView)` would pass the array index as the second arg.
      const libraryView = (b: (typeof parsedBooks)[number]) => bookView(b, b.createdAt);
      const activityView = (b: (typeof parsedBooks)[number]) => bookView(b, b.indexedAt);

      const response: GetProfileOutputSchema = {
        profile: {
          displayName: profile?.displayName ?? profile?.handle ?? did,
          avatar: profile?.avatar,
          handle: profile?.handle ?? did,
          description: profile?.description,
          booksRead: books.filter((b) => b.status === BOOK_STATUS.FINISHED).length,
          reviews: books.filter((b) => b.review).length,
          isFollowing,
        },
        friendActivity: parsedFriendsBuzzes.map(activityView),
        books: parsedBooks.map(libraryView),
        // Newest activity per book, newest first — every timestamp is `indexedAt` under the `createdAt` name (see `bookView`).
        activity: books
          .reduce(
            (acc, b) => {
              const existing = acc.find((a) => a.hiveId === b.hiveId);
              if (!existing || new Date(b.indexedAt) > new Date(existing.createdAt)) {
                if (existing) {
                  acc.splice(acc.indexOf(existing), 1);
                }
                acc.push({
                  type:
                    b.status === BOOK_STATUS.FINISHED
                      ? "finished"
                      : b.review
                        ? "review"
                        : "started",
                  createdAt: b.indexedAt,
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

  router.addQuery(BuzzBookhiveGetLanguages, {
    async handler() {
      const ctx = getCtx();
      const languages = await getAvailableLanguages(ctx.db, ctx.kv);
      return json({ languages });
    },
  });

  router.addQuery(BuzzBookhiveGetExplore, {
    async handler({ params: _params }) {
      const ctx = getCtx();
      // Both aggregates are cached with SWR inside their helpers, shared with /explore and /explore/authors.
      // `language` is narrowed to one we have books in before it can key a cache entry — it's lexicon-typed as a free-form string otherwise.
      const language = await resolveLanguage(
        ctx.db,
        ctx.kv,
        (_params as BuzzBookhiveGetExplore.$params).language,
      );

      const [genreRows, topAuthors] = await Promise.all([
        getTopGenres(ctx.db, ctx.kv, 6, language),
        getFeaturedAuthors(ctx.db, ctx.kv, 8, language),
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
    // Thin adapter over `getActivityFeed` (`src/data/activityFeed.ts`).
    async handler({ params: _params }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      const params = _params as BuzzBookhiveGetFeed.$params;

      const tab = FEED_TABS.includes(params.tab as FeedTab) ? (params.tab as FeedTab) : "friends";

      // Shipped iOS builds paginate with `page`; a page-2 request with no cursor ends the feed instead of looping `onEndReached` forever.
      const legacyPage = params.page ?? 1;
      if (!params.cursor && legacyPage > 1) {
        return json({
          activities: [],
          groups: [],
          hasMore: false,
          page: legacyPage,
        } satisfies BuzzBookhiveGetFeed.$output);
      }

      const feed = await getActivityFeed({
        ctx,
        viewerDid: agent?.did ?? null,
        tab,
        limit: params.limit ?? DEFAULT_FEED_LIMIT,
        cursor: params.cursor,
        collapse: params.collapse ?? true,
      });

      if (!feed.ok) {
        throw new AuthRequiredError({
          message: `The ${tab} feed requires authentication`,
        });
      }

      const toActivity = (item: FeedItem) => ({
        userDid: item.actorDid,
        userHandle: feed.didHandleMap[item.actorDid] ?? item.actorDid,
        userAvatar: feed.profileByDid[item.actorDid]?.avatar ?? undefined,
        hiveId: item.book.hiveId,
        title: item.book.title,
        authors: item.book.authors,
        status: item.book.status ?? undefined,
        stars: item.book.stars ?? undefined,
        review: item.book.review ?? undefined,
        createdAt: item.book.createdAt,
        indexedAt: item.ts,
        thumbnail: item.book.thumbnail || "",
        cover: item.book.cover ?? item.book.thumbnail ?? undefined,
      });

      const groups = feed.groups.map((g) =>
        g.kind === "single"
          ? {
              kind: "single" as const,
              verb: g.item.verb,
              total: 1,
              activities: [toActivity(g.item)],
            }
          : {
              kind: "burst" as const,
              verb: g.verb,
              total: g.total,
              truncated: g.truncated,
              activities: g.items.map(toActivity),
            },
      );

      // A burst row only renders a few covers plus `total`, so capping group previews avoids sending huge items for nothing.
      // The flat `activities` array stays uncapped — the cursor advances past every raw row, so trimming it drops rows flat-list clients can never see again.
      const BURST_PREVIEW_ITEMS = 8;

      return json({
        // Flat list kept populated so shipped clients that only read `activities` keep working; bursts are expanded here.
        activities: groups.flatMap((g) => g.activities),
        groups: groups.map((g) =>
          g.activities.length > BURST_PREVIEW_ITEMS
            ? { ...g, activities: g.activities.slice(0, BURST_PREVIEW_ITEMS) }
            : g,
        ),
        cursor: feed.nextCursor ?? undefined,
        hasMore: feed.nextCursor != null,
      } satisfies BuzzBookhiveGetFeed.$output);
    },
  });

  router.addQuery(BuzzBookhiveGetAuthorBooks, {
    async handler({ params: _params }) {
      const ctx = getCtx();
      const {
        author,
        page = 1,
        limit = 25,
        sort = "popularity",
        language,
      } = _params as BuzzBookhiveGetAuthorBooks.$params;

      const pageSize = Math.min(100, limit);

      // Same core as `/authors/:author` — the count here is index-only (no `hive_book` join) and the ORDER BY ends on a unique key.
      const {
        books,
        totalBooks,
        totalPages,
        currentPage: validPage,
      } = await listBooksByAuthor({
        db: ctx.db,
        author,
        page,
        pageSize,
        sort: sort === "reviews" ? "reviews" : "popularity",
        language,
      });

      const genreMap = await loadGenresMapForHiveBooks(
        ctx.db,
        books.map((b) => b.id),
      );

      return json({
        author,
        books: books.map((b) => transformBookWithIdentifiers(b, genreMap.get(b.id))),
        totalBooks,
        totalPages,
        page: validPage,
      });
    },
  });

  router.addQuery(BuzzBookhiveGetReadingStats, {
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { handle, year: yearParam } = _params as BuzzBookhiveGetReadingStats.$params;
      const year = yearParam ?? new Date().getFullYear();

      // `resolveActorDid`, not `startsWith("did:")` — the latter let malformed values like `did:%%%` reach the resolver.
      const did = await resolveActorDid(ctx, handle);

      if (!did) {
        throw new XRPCError({
          status: 404,
          error: "NotFound",
          message: "User not found",
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

      // Shares the year filter, genre aggregate and available-years window with the web page and OG card.
      // NOTE: `getReadingStatsForYear` also returns an all-time fallback this lexicon has no field for, so
      // the app shows a near-empty year where the website falls back to all-time — needs a lexicon field plus an app release.
      const { stats, availableYears } = await getReadingStatsForYear({
        db: ctx.db,
        books: parsedBooks,
        year,
      });

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
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveCreateList.$input;

      const result = await createList({
        agent,
        db: ctx.db,
        name: input.name,
        description: input.description,
        ordered: input.ordered,
        tags: input.tags,
      });

      if (!result.ok) throw listErrorFor(result);

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveUpdateList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveUpdateList.$input;

      const result = await updateList({
        agent,
        db: ctx.db,
        uri: input.uri,
        name: input.name,
        description: input.description,
        ordered: input.ordered,
        tags: input.tags,
      });

      if (!result.ok) throw listErrorFor(result);

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveDeleteList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveDeleteList.$input;

      const deleted = await deleteList({ agent, db: ctx.db, uri: input.uri });
      if (!deleted.ok) throw listErrorFor(deleted);

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveAddToList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveAddToList.$input;

      const result = await addBookToList({
        agent,
        db: ctx.db,
        listUri: input.listUri,
        hiveId: input.hiveId as HiveId,
        description: input.description,
        position: input.position,
      });

      if (!result.ok) throw listErrorFor(result);

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveRemoveFromList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveRemoveFromList.$input;

      const removed = await removeBookFromList({ agent, db: ctx.db, itemUri: input.itemUri });
      if (!removed.ok) throw listErrorFor(removed);

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveReorderList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveReorderList.$input;

      const reordered = await reorderListItems({
        agent,
        db: ctx.db,
        listUri: input.listUri,
        itemUris: input.itemUris,
      });
      if (!reordered.ok) throw listErrorFor(reordered);

      return json({});
    },
  });

  // ── GetUserLists query ──

  router.addQuery(BuzzBookhiveGetUserLists, {
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { did } = _params as BuzzBookhiveGetUserLists.$params;

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
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { uri } = _params as BuzzBookhiveGetList.$params;

      const data = await getListWithItems({ db: ctx.db, listUri: uri });
      if (!data) {
        throw new XRPCError({
          status: 404,
          error: "NotFound",
          message: "List not found",
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
          title: item.title ?? item.embeddedTitle ?? undefined,
          authors: item.authors ?? item.embeddedAuthor ?? undefined,
          thumbnail: item.thumbnail || item.embeddedCoverUrl || undefined,
          cover: item.cover ?? item.thumbnail ?? item.embeddedCoverUrl ?? undefined,
          rating: item.rating != null ? Math.round(item.rating * 10) : undefined,
        })),
      });
    },
  });

  // ── Personal Library CRUD ──

  router.addQuery(BuzzBookhiveGetPersonalLibrary, {
    auth: "identity",
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const params = _params as BuzzBookhiveGetPersonalLibrary.$params;
      const { limit = 24, shelfId, q } = params;
      // The lexicon's known-values are a hint, not a constraint — narrow it rather than trusting the wire.
      const sort: PersonalBookSort =
        params.sort === "title" ? "title" : params.sort === "author" ? "author" : "recent";
      const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

      const [{ rows: books, total }, usedBytes] = await Promise.all([
        listPersonalBooks({
          db: ctx.db,
          userDid,
          shelfId,
          q,
          sort,
          limit,
          offset,
          withProgress: true,
        }),
        // Bundled here rather than its own method — clients already refetch this on mount and after each mutation.
        getStorageUsage(ctx.db, userDid),
      ]);

      const hasMore = offset + books.length < total;
      const shelfIdsByBook = await shelfIdsForBooks({
        db: ctx.db,
        userDid,
        bookIds: books.map((b) => b.id),
      });

      return json({
        books: books.map((b) =>
          personalBookView(b, {
            shelfIds: shelfIdsByBook.get(b.id) ?? [],
            progress: syncProgressView(b.progressData, b.progressUpdatedAt),
          }),
        ),
        total,
        cursor: hasMore ? String(offset + limit) : undefined,
        storage: { usedBytes, quotaBytes: getStorageQuota() },
      });
    },
  });

  router.addQuery(BuzzBookhiveGetPersonalBook, {
    auth: "identity",
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash } = _params as BuzzBookhiveGetPersonalBook.$params;

      const book = await getPersonalBookRow({ db: ctx.db, userDid, contentHash });
      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      return json({ book: personalBookView(book) });
    },
  });

  // The XRPC equivalent of GET /opds/books/:hash/download/{name}.ext.
  // Returns a bare `Response` rather than `json(...)` — the lexicon declares a blob output, so this handler owns all headers itself.
  router.addQuery(BuzzBookhiveGetPersonalBookFile, {
    auth: "identity",
    async handler({ request, params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash } = _params as BuzzBookhiveGetPersonalBookFile.$params;

      // `streamPersonalBook` answers the conditional request itself — this route must not lean on hono's `etag()`, which buffers the whole body.
      const download = await streamPersonalBook(
        ctx.db,
        userDid,
        contentHash,
        request.headers.get("if-none-match"),
        {
          range: request.headers.get("range"),
          ifRange: request.headers.get("if-range"),
        },
      );
      // 404 rather than 403 for someone else's book — don't leak existence.
      if (!download) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }
      return new Response(download.stream, { status: download.status, headers: download.headers });
    },
  });

  // The XRPC equivalent of GET /opds/books/:hash/cover.
  router.addQuery(BuzzBookhiveGetPersonalBookCover, {
    auth: "identity",
    async handler({ request, params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash, width = 300 } = _params as BuzzBookhiveGetPersonalBookCover.$params;

      const book = await ctx.db
        .selectFrom("personal_book")
        .select(["coverPath", "coverMime", "hiveId"])
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .executeTakeFirst();
      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      if (book.coverPath) {
        const file = Bun.file(book.coverPath);
        if (await file.exists()) {
          // Set our own ETag — hono's `etag()` only digests (and buffers) a response that doesn't already carry one.
          const etag = `"${contentHash}-cover"`;
          if (etagMatches(request.headers.get("if-none-match"), etag)) {
            return new Response(null, { status: 304, headers: { ETag: etag } });
          }
          return new Response(file.stream(), {
            headers: {
              "Content-Type": book.coverMime || "image/jpeg",
              "Content-Length": String(file.size),
              "Cache-Control": "private, max-age=86400",
              ETag: etag,
            },
          });
        }
      }

      // No extracted cover but linked to a catalog entry — redirect to the public image proxy, absolute so a non-browser client can follow it.
      if (book.hiveId) {
        // Built by hand rather than `Response.redirect`, whose headers are immutable — downstream middleware setting headers would throw.
        return new Response(null, {
          status: 302,
          headers: {
            Location: new URL(`/images/books/${book.hiveId}?w=${width}`, request.url).toString(),
          },
        });
      }
      throw new XRPCError({ status: 404, error: "NotFound", message: "No cover for this book" });
    },
  });

  // The root call for a catalog client — everything GET /opds renders, in one request.
  router.addQuery(BuzzBookhiveListPersonalShelves, {
    auth: "identity",
    async handler() {
      const ctx = getCtx();
      const { did: userDid } = getAuth();

      const [shelves, counted, usedBytes] = await Promise.all([
        ctx.db
          .selectFrom("personal_shelf")
          .leftJoin("personal_shelf_item", "personal_shelf.id", "personal_shelf_item.shelfId")
          .select((eb) => [
            "personal_shelf.id",
            "personal_shelf.name",
            "personal_shelf.description",
            "personal_shelf.createdAt",
            "personal_shelf.updatedAt",
            eb.fn.count<number>("personal_shelf_item.personalBookId").as("bookCount"),
          ])
          .where("personal_shelf.userDid", "=", userDid)
          .groupBy("personal_shelf.id")
          .orderBy("personal_shelf.name", "asc")
          .execute(),
        ctx.db
          .selectFrom("personal_book")
          .select((eb) => eb.fn.countAll<number>().as("total"))
          .where("userDid", "=", userDid)
          .executeTakeFirstOrThrow(),
        getStorageUsage(ctx.db, userDid),
      ]);

      return json({
        shelves: shelves.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? undefined,
          bookCount: Number(s.bookCount),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        totalBooks: Number(counted.total),
        storage: { usedBytes, quotaBytes: getStorageQuota() },
      });
    },
  });

  // The blob-input twin of POST /library/upload — the body streams straight to disk, never materialised in memory.
  router.addProcedure(BuzzBookhiveUploadPersonalBook, {
    auth: "identity",
    async handler({ request, params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { filename } = _params as BuzzBookhiveUploadPersonalBook.$params;

      const declared = Number(request.headers.get("content-length"));
      const result = await uploadPersonalBook({
        db: ctx.db,
        kv: ctx.kv,
        userDid,
        filename,
        source: {
          kind: "stream",
          // The lexicon declares a blob input, so atcute leaves the body alone and types it as a stream.
          body: request.body as ReadableStream<Uint8Array>,
          declaredLength: Number.isFinite(declared) && declared > 0 ? declared : undefined,
        },
      });

      if (!result.ok) throw uploadErrorFor(result);
      return json({
        book: result.book,
        storageUsedBytes: result.storageUsedBytes,
        storageQuotaBytes: result.storageQuotaBytes,
      });
    },
  });

  router.addProcedure(BuzzBookhiveDeletePersonalBook, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash } = _input as BuzzBookhiveDeletePersonalBook.$input;

      const book = await ctx.db
        .selectFrom("personal_book")
        .select(["id"])
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .executeTakeFirst();

      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      // Remove shelf items referencing this book first
      await ctx.db
        .deleteFrom("personal_shelf_item")
        .where("personalBookId", "=", book.id)
        .execute();

      await ctx.db
        .deleteFrom("personal_book")
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .execute();

      // Best-effort — the row is already gone either way, and failing here would 500 an otherwise-successful delete.
      await removeBookDir(userDid, contentHash).catch((err: unknown) => {
        ctx.addWideEventContext({
          personal_book_rm: "failed",
          error: { message: errorMessage(err) },
        });
      });

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveLinkPersonalBook, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash, hiveId } = _input as BuzzBookhiveLinkPersonalBook.$input;

      const book = await ctx.db
        .selectFrom("personal_book")
        .selectAll()
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .executeTakeFirst();

      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      const hiveBook = await ctx.db
        .selectFrom("hive_book")
        .select(["id", "title", "authors", "cover", "thumbnail"])
        .where("id", "=", hiveId as HiveId)
        .executeTakeFirst();

      if (!hiveBook) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Hive book not found" });
      }

      const now = new Date().toISOString();
      await ctx.db
        .updateTable("personal_book")
        .set({
          hiveId: hiveBook.id,
          // The file's metadata stays authoritative, including after unlinking.
          updatedAt: now,
        })
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .execute();

      await ctx.db
        .updateTable("sync_document")
        .set({ hiveId: hiveBook.id })
        .where("userDid", "=", userDid)
        .where("documentHash", "=", contentHash)
        .execute();

      await ctx.db
        .updateTable("user_book")
        .set({ owned: 1 })
        .where("userDid", "=", userDid)
        .where("hiveId", "=", hiveBook.id)
        .where("owned", "=", 0)
        .execute();

      // Re-read rather than assemble the response by hand — hand-assembling let these three methods drift on which fields they returned.
      const linked = await getPersonalBookRow({ db: ctx.db, userDid, contentHash });
      if (!linked) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }
      return json({ book: personalBookView(linked) });
    },
  });

  router.addProcedure(BuzzBookhiveUnlinkPersonalBook, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash } = _input as BuzzBookhiveUnlinkPersonalBook.$input;

      const book = await ctx.db
        .selectFrom("personal_book")
        .selectAll()
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .executeTakeFirst();

      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      const now = new Date().toISOString();
      await ctx.db
        .updateTable("personal_book")
        .set({ hiveId: null, updatedAt: now })
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .execute();

      // linkPersonalBook propagates hiveId onto the matching sync_document; unlinking must undo that too.
      await ctx.db
        .updateTable("sync_document")
        .set({ hiveId: null })
        .where("userDid", "=", userDid)
        .where("documentHash", "=", contentHash)
        .execute();

      const unlinked = await getPersonalBookRow({ db: ctx.db, userDid, contentHash });
      if (!unlinked) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }
      return json({ book: personalBookView(unlinked) });
    },
  });

  // ── Personal Shelf Management ──

  router.addProcedure(BuzzBookhiveCreatePersonalShelf, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { name, description } = _input as BuzzBookhiveCreatePersonalShelf.$input;

      const now = new Date().toISOString();
      const result = await ctx.db
        .insertInto("personal_shelf")
        .values({
          userDid,
          name,
          description: description ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning(["id", "name", "description", "createdAt", "updatedAt"])
        .executeTakeFirstOrThrow();

      return json({
        shelf: {
          id: result.id,
          name: result.name,
          description: result.description ?? undefined,
          bookCount: 0,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        },
      });
    },
  });

  router.addProcedure(BuzzBookhiveUpdatePersonalShelf, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { id, name, description } = _input as BuzzBookhiveUpdatePersonalShelf.$input;

      const existing = await ctx.db
        .selectFrom("personal_shelf")
        .select(["id"])
        .where("id", "=", id)
        .where("userDid", "=", userDid)
        .executeTakeFirst();

      if (!existing) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Shelf not found" });
      }

      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updatedAt: now };
      if (name !== undefined) updates["name"] = name;
      if (description !== undefined) updates["description"] = description;

      await ctx.db
        .updateTable("personal_shelf")
        .set(updates)
        .where("id", "=", id)
        .where("userDid", "=", userDid)
        .execute();

      const shelf = await ctx.db
        .selectFrom("personal_shelf")
        .select(["id", "name", "description", "createdAt", "updatedAt"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      const countResult = await ctx.db
        .selectFrom("personal_shelf_item")
        .select(sql<number>`COUNT(*)`.as("count"))
        .where("shelfId", "=", id)
        .executeTakeFirst();

      return json({
        shelf: {
          id: shelf.id,
          name: shelf.name,
          description: shelf.description ?? undefined,
          bookCount: Number(countResult?.count ?? 0),
          createdAt: shelf.createdAt,
          updatedAt: shelf.updatedAt,
        },
      });
    },
  });

  router.addProcedure(BuzzBookhiveDeletePersonalShelf, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { id } = _input as BuzzBookhiveDeletePersonalShelf.$input;

      const existing = await ctx.db
        .selectFrom("personal_shelf")
        .select(["id"])
        .where("id", "=", id)
        .where("userDid", "=", userDid)
        .executeTakeFirst();

      if (!existing) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Shelf not found" });
      }

      await ctx.db.deleteFrom("personal_shelf_item").where("shelfId", "=", id).execute();
      await ctx.db
        .deleteFrom("personal_shelf")
        .where("id", "=", id)
        .where("userDid", "=", userDid)
        .execute();

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveAddToPersonalShelf, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { shelfId, contentHash } = _input as BuzzBookhiveAddToPersonalShelf.$input;

      const shelf = await ctx.db
        .selectFrom("personal_shelf")
        .select(["id"])
        .where("id", "=", shelfId)
        .where("userDid", "=", userDid)
        .executeTakeFirst();

      if (!shelf) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Shelf not found" });
      }

      const book = await ctx.db
        .selectFrom("personal_book")
        .select(["id"])
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .executeTakeFirst();

      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      const now = new Date().toISOString();
      await ctx.db
        .insertInto("personal_shelf_item")
        .values({ shelfId, personalBookId: book.id, createdAt: now })
        .onConflict((oc) => oc.doNothing())
        .execute();

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveRemoveFromPersonalShelf, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { shelfId, contentHash } = _input as BuzzBookhiveRemoveFromPersonalShelf.$input;

      const shelf = await ctx.db
        .selectFrom("personal_shelf")
        .select(["id"])
        .where("id", "=", shelfId)
        .where("userDid", "=", userDid)
        .executeTakeFirst();

      if (!shelf) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Shelf not found" });
      }

      const book = await ctx.db
        .selectFrom("personal_book")
        .select(["id"])
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .executeTakeFirst();

      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      await ctx.db
        .deleteFrom("personal_shelf_item")
        .where("shelfId", "=", shelfId)
        .where("personalBookId", "=", book.id)
        .execute();

      return json({});
    },
  });

  // ── Sync Progress (XRPC mirrors of KOSync) ──

  router.addQuery(BuzzBookhiveGetSyncProgress, {
    auth: "identity",
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash } = _params as BuzzBookhiveGetSyncProgress.$params;

      const doc = await getSyncDocument({ db: ctx.db, userDid, document: contentHash });
      if (!doc) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Document not found" });
      }

      // Every field here is `required` in the lexicon, so an unreadable progress blob gets defaults rather than `undefined`.
      return json({
        document: doc.document,
        progress: doc.progress ?? "",
        // String, not a number — the lexicon declares it that way; the KOSync REST twin answers a number instead.
        percentage: String(doc.percentage),
        device: doc.device ?? "",
        device_id: doc.deviceId ?? "",
        timestamp: doc.timestamp ?? 0,
      });
    },
  });

  router.addProcedure(BuzzBookhivePutSyncProgress, {
    auth: "identity",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const input = _input as BuzzBookhivePutSyncProgress.$input;
      const { document, progress, percentage: percentageStr, device, device_id, metadata } = input;

      const percentage = parseFloat(percentageStr);
      if (isNaN(percentage)) {
        throw new XRPCError({
          status: 400,
          error: "InvalidRequest",
          message: "Invalid percentage",
        });
      }

      await recordSyncProgress({
        db: ctx.db,
        kv: ctx.kv,
        userDid,
        document,
        progress,
        percentage,
        device,
        deviceId: device_id,
        metadata,
      });

      return json({ status: "success" });
    },
  });

  router.addQuery(BuzzBookhiveListSyncDocuments, {
    auth: "identity",
    async handler() {
      const ctx = getCtx();
      const { did: userDid } = getAuth();

      const documents = (await listSyncDocuments({ db: ctx.db, userDid })).map((doc) => ({
        documentHash: doc.document,
        progress: doc.progress ?? "",
        percentage: String(doc.percentage),
        device: doc.device ?? "",
        device_id: doc.deviceId ?? "",
        filename: doc.filename ?? undefined,
        title: doc.title ?? undefined,
        authors: doc.authors ?? undefined,
        hiveId: doc.hiveId ?? undefined,
        dismissed: doc.dismissed,
        timestamp: doc.timestamp ?? 0,
      }));

      return json({ documents });
    },
  });

  app.all("/xrpc/*", (c) => xrpcContextStorage.run(c.get("ctx"), () => router.fetch(c.req.raw)));
}
