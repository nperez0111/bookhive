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
import { BOOK_STATUS_MAP } from "../constants";
import { BookFields } from "../db";
import type { Database } from "../db";
import type { HiveId } from "../types";
import { hydrateUserBook } from "../utils/bookProgress";
import { loadGenresForHiveBook, loadGenresMapForHiveBooks } from "../utils/hiveBookGenres.js";
import { getTopAuthors } from "../pages/authorDirectory";
import { getAvailableLanguages } from "../utils/getLanguages";
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
import type {
  BookIdentifiers,
  HiveBook,
  HiveId as HiveIdType,
  ProfileViewDetailed,
  SyncProgressData,
} from "../types";
import {
  etagMatches,
  getStorageQuota,
  getStorageUsage,
  removeBookDir,
  streamPersonalBook,
} from "../utils/personalLibrary";
import { uploadPersonalBook, type UploadPersonalBookResult } from "../utils/uploadPersonalBook";
import { resolveXrpcAuth, type AuthMode, type XrpcAuth, type XrpcAuthContext } from "./auth";
import type { Nsid } from "@atcute/lexicons";
import type { ServiceJwtVerifier } from "@atcute/xrpc-server/auth";
import { matchSyncDocumentForUser, NO_HIVE_MATCH, SAME_BOOK_FILE } from "../utils/syncMatching";
import { filenameKey } from "../utils/filenameMatching";
import { bridgeProgressToUserBook } from "../utils/syncBridge";
import { truncateForLog } from "../middleware/wide-event";

/**
 * The one place the upload core's failure reasons become XRPC errors, so the
 * XRPC and multipart adapters can't drift on what a given failure means. The
 * matching HTTP mapping lives in `src/routes/library.tsx`.
 */
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

/**
 * Shape a `sync_document.progressData` blob into the lexicon's syncProgressView.
 * Returns undefined when the book has never been synced or the blob is unusable.
 */
function syncProgressView(
  progressData: string | null,
  progressUpdatedAt: string | null,
): { percentage: string; device?: string; updatedAt: string } | undefined {
  if (!progressData || !progressUpdatedAt) return undefined;
  try {
    const data = JSON.parse(progressData) as SyncProgressData;
    return {
      percentage: String(data.percentage ?? 0),
      device: data.device || undefined,
      updatedAt: progressUpdatedAt,
    };
  } catch {
    return undefined;
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
  /**
   * Gate on service auth: has this DID ever used BookHive? Required — see the
   * note on `XrpcAuthContext`. The verifier stays optional (null genuinely
   * means "service auth is off"), but the gate must never be absent.
   */
  isKnownAccount: (did: string) => Promise<boolean>;
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

/**
 * Auth resolved for the in-flight handler, by the registration wrapper below.
 * Same AsyncLocalStorage idiom as the context — atcute handlers only receive
 * `{request, params, input, signal}`, so there is nowhere else to put it.
 */
const xrpcAuthStorage = new AsyncLocalStorage<XrpcAuth>();

/** The authenticated caller. Only valid inside a handler registered with `auth`. */
function getAuth(): XrpcAuth {
  const auth = xrpcAuthStorage.getStore();
  if (!auth) throw new Error("XRPC auth not resolved (method registered without `auth`)");
  return auth;
}

/**
 * The caller's OAuth session, for handlers that write to their repo. Non-null by
 * construction — `auth: "pdsWrite"` refuses service auth before the handler runs
 * — but narrowing the union keeps that guarantee in the types rather than in a
 * comment.
 */
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

  // Two things are patched onto every registration here rather than repeated in
  // 40+ handlers (where the next one added would forget them):
  //
  // 1. **Error observability.** XRPCRouter catches handler throws and turns them
  //    into a 500 Response, so Hono's error-capture middleware never sees them
  //    and the wide event logs an error-level line with no `error` field at all.
  //    Record the cause on the way past.
  // 2. **Authentication**, when the registration carries an `auth` mode. The
  //    `lxm` a service-auth token must be bound to is derived from the schema's
  //    own NSID, which makes it structurally impossible for a method's route and
  //    its token binding to disagree.
  for (const method of ["addQuery", "addProcedure"] as const) {
    const original = router[method].bind(router) as (schema: unknown, options: any) => unknown;
    (router as any)[method] = (schema: any, options: any) => {
      const handler = options?.handler;
      if (typeof handler !== "function") return original(schema, options);

      // A generated lexicon module carries `mainSchema`; `v.query`/`v.procedure`
      // put the NSID on it. Same unwrap atcute does internally.
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
            // Auth failures land inside this try, so a 401 is recorded as the
            // intentional control flow it is — same as a hand-thrown one.
            return await xrpcAuthStorage.run(auth, () => handler(input));
          } catch (err) {
            // Deliberate 4xx (AuthRequiredError, InvalidRequest, …) are control
            // flow, not defects — record them without a stack.
            const status = (err as { status?: unknown } | null)?.status;
            const isIntentional = typeof status === "number" && status < 500;
            xrpcContextStorage.getStore()?.addWideEventContext({
              xrpc_handler: "threw",
              error: {
                message: err instanceof Error ? err.message : String(err),
                type: err instanceof Error ? err.name : "Error",
                ...(!isIntentional && err instanceof Error && err.stack
                  ? { stack: truncateForLog(err.stack) }
                  : {}),
              },
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

        // Language is a soft preference: sort matching-language books first
        if (language) {
          genreQuery = genreQuery.orderBy(
            sql`CASE WHEN hive_book.language = ${language} THEN 0 ELSE 1 END`,
            "asc",
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

      let booksQuery = ctx.db.selectFrom("hive_book").selectAll().where("id", "in", allIds);

      const books = await booksQuery.limit(limit * off + limit).execute();

      // Language is a soft preference: sort matching-language books first, then by relevance
      if (language) {
        books.sort((a, b) => {
          const aMatch = a.language === language ? 0 : 1;
          const bMatch = b.language === language ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
          return allIds.indexOf(a.id) - allIds.indexOf(b.id);
        });
      } else {
        books.sort((a, b) => allIds.indexOf(a.id) - allIds.indexOf(b.id));
      }

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
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { limit = 50, offset = 0, minBooks = 0 } = _params as BuzzBookhiveListGenres.$params;

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
          previousReads: b.previousReads ?? undefined,
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
          previousReads: b.previousReads ?? undefined,
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
      const language = (_params as BuzzBookhiveGetExplore.$params).language || undefined;

      let genreQuery = ctx.db
        .selectFrom("hive_book_genre")
        .select(["genre", sql<number>`COUNT(*)`.as("count")]);

      if (language) {
        genreQuery = genreQuery
          .innerJoin("hive_book", "hive_book_genre.hiveId", "hive_book.id")
          .where("hive_book.language", "=", language) as any;
      }

      const [genreRows, topAuthors] = await Promise.all([
        genreQuery
          .groupBy("genre")
          .orderBy(sql`COUNT(*)`, "desc")
          .limit(6)
          .execute(),
        getTopAuthors(ctx.db, 8, language),
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
    async handler({ params: _params }) {
      const ctx = getCtx();
      const agent = await ctx.getSessionAgent();
      const params = _params as BuzzBookhiveGetFeed.$params;

      const tab = (params.tab as "friends" | "all" | "tracking") || "friends";
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(50, params.limit ?? 25);
      const offset = (page - 1) * limit;

      if ((tab === "friends" || tab === "tracking") && !agent) {
        throw new AuthRequiredError({
          message: `The ${tab} feed requires authentication`,
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

      let countQuery = ctx.db
        .selectFrom("hive_book")
        .select(sql<number>`COUNT(*)`.as("count"))
        .where(authorCondition as any);

      let dataQuery = ctx.db
        .selectFrom("hive_book")
        .selectAll()
        .where(authorCondition as any);

      // Language is a soft preference: sort matching-language books first, don't filter
      if (language) {
        dataQuery = dataQuery.orderBy(
          sql`CASE WHEN language = ${language} THEN 0 ELSE 1 END`,
          "asc",
        );
      }

      const [totalCountResult, books] = await Promise.all([
        countQuery.executeTakeFirst(),
        dataQuery
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
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { handle, year: yearParam } = _params as BuzzBookhiveGetReadingStats.$params;
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

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveDeleteList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveDeleteList.$input;

      await deleteList({ agent, db: ctx.db, uri: input.uri });

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

      return json(result);
    },
  });

  router.addProcedure(BuzzBookhiveRemoveFromList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveRemoveFromList.$input;

      await removeBookFromList({ agent, db: ctx.db, itemUri: input.itemUri });

      return json({});
    },
  });

  router.addProcedure(BuzzBookhiveReorderList, {
    auth: "pdsWrite",
    async handler({ input: _input }) {
      const ctx = getCtx();
      const agent = requireAgent();
      const input = _input as BuzzBookhiveReorderList.$input;

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

  // ── Personal Library CRUD ──

  router.addQuery(BuzzBookhiveGetPersonalLibrary, {
    auth: "identity",
    async handler({ params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const params = _params as BuzzBookhiveGetPersonalLibrary.$params;
      const { limit = 24, shelfId, q, sort = "recent" } = params;
      const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

      let query = ctx.db
        .selectFrom("personal_book")
        .leftJoin("hive_book", "personal_book.hiveId", "hive_book.id")
        .select([
          "personal_book.id",
          "personal_book.contentHash",
          "personal_book.hiveId",
          "personal_book.filename",
          "personal_book.title",
          "personal_book.authors",
          "personal_book.language",
          "personal_book.format",
          "personal_book.mime",
          "personal_book.filePath",
          "personal_book.coverPath",
          "personal_book.coverMime",
          "personal_book.sizeBytes",
          "personal_book.createdAt",
          "personal_book.updatedAt",
          "hive_book.cover as hiveCover",
          "hive_book.thumbnail as hiveThumbnail",
          "hive_book.description as hiveDescription",
        ])
        // E-reader progress for this file. Correlated subqueries rather than a
        // join: a file can match more than one synced document (the same book
        // read on a device in BINARY checksum mode and another in FILENAME
        // mode is two rows — see SAME_BOOK_FILE), and a join would emit the
        // book once per match and quietly corrupt this query's pagination.
        // Most recent wins.
        .select((eb) => [
          eb
            .selectFrom("sync_document")
            .select("sync_document.progressData")
            .where("sync_document.userDid", "=", userDid)
            .where("sync_document.provider", "=", "kosync")
            .where(SAME_BOOK_FILE)
            .orderBy("sync_document.updatedAt", "desc")
            .limit(1)
            .as("progressData"),
          eb
            .selectFrom("sync_document")
            .select("sync_document.updatedAt")
            .where("sync_document.userDid", "=", userDid)
            .where("sync_document.provider", "=", "kosync")
            .where(SAME_BOOK_FILE)
            .orderBy("sync_document.updatedAt", "desc")
            .limit(1)
            .as("progressUpdatedAt"),
        ])
        .where("personal_book.userDid", "=", userDid);

      // Same predicate and ordering as the OPDS search feed, so "full parity"
      // is a property of the SQL rather than a claim. SQLite's LIKE is
      // case-insensitive for ASCII only; that is pre-existing OPDS behaviour
      // and deliberately preserved rather than silently changed here.
      if (q) {
        query = query.where((eb) =>
          eb.or([
            eb("personal_book.title", "like", `%${q}%`),
            eb("personal_book.authors", "like", `%${q}%`),
          ]),
        ) as typeof query;
      }
      // Every sort ends on `personal_book.id`. None of the leading keys are
      // unique: titles and authors collide routinely (a series, an omnibus, the
      // same book in two formats), and `createdAt` — millisecond-precision ISO
      // — collides when two uploads commit in the same millisecond. SQLite is
      // free to return ties in any order it likes between two LIMIT/OFFSET
      // queries, so without a unique final key a book can appear on two
      // consecutive pages while another never appears at all.
      query =
        sort === "title"
          ? (query
              .orderBy("personal_book.title", "asc")
              .orderBy("personal_book.id", "asc") as typeof query)
          : sort === "author"
            ? (query
                .orderBy("personal_book.authors", "asc")
                .orderBy("personal_book.title", "asc")
                .orderBy("personal_book.id", "asc") as typeof query)
            : (query
                .orderBy("personal_book.createdAt", "desc")
                .orderBy("personal_book.id", "desc") as typeof query);

      if (shelfId !== undefined) {
        query = query
          .innerJoin(
            "personal_shelf_item",
            "personal_book.id",
            "personal_shelf_item.personalBookId",
          )
          .where("personal_shelf_item.shelfId", "=", shelfId) as typeof query;
      }

      // Total across all pages, so the UI can label the tab without having to
      // page through everything first.
      let countQuery = ctx.db
        .selectFrom("personal_book")
        .select((eb) => eb.fn.countAll<number>().as("total"))
        .where("personal_book.userDid", "=", userDid);
      if (q) {
        countQuery = countQuery.where((eb) =>
          eb.or([
            eb("personal_book.title", "like", `%${q}%`),
            eb("personal_book.authors", "like", `%${q}%`),
          ]),
        ) as typeof countQuery;
      }
      if (shelfId !== undefined) {
        countQuery = countQuery
          .innerJoin(
            "personal_shelf_item",
            "personal_book.id",
            "personal_shelf_item.personalBookId",
          )
          .where("personal_shelf_item.shelfId", "=", shelfId) as typeof countQuery;
      }

      const [rows, counted, usedBytes] = await Promise.all([
        query
          .limit(limit + 1)
          .offset(offset)
          .execute(),
        countQuery.executeTakeFirstOrThrow(),
        // Bundled here rather than exposed as its own method: every client
        // already refetches this on mount and after each mutation, so a usage
        // bar updates with no extra round-trip and no new invalidation wiring.
        getStorageUsage(ctx.db, userDid),
      ]);
      const hasMore = rows.length > limit;
      const books = rows.slice(0, limit);
      const nextCursor = hasMore ? String(offset + limit) : undefined;

      // Shelf membership for the whole page in one query, so the client doesn't
      // have to fan out a request per shelf to reconstruct it.
      const shelfIdsByBook = new Map<number, number[]>();
      if (books.length > 0) {
        const memberships = await ctx.db
          .selectFrom("personal_shelf_item")
          .innerJoin("personal_shelf", "personal_shelf.id", "personal_shelf_item.shelfId")
          .select(["personal_shelf_item.personalBookId", "personal_shelf_item.shelfId"])
          .where("personal_shelf.userDid", "=", userDid)
          .where(
            "personal_shelf_item.personalBookId",
            "in",
            books.map((b) => b.id),
          )
          .execute();
        for (const m of memberships) {
          const list = shelfIdsByBook.get(m.personalBookId);
          if (list) list.push(m.shelfId);
          else shelfIdsByBook.set(m.personalBookId, [m.shelfId]);
        }
      }

      return json({
        books: books.map((b) => ({
          contentHash: b.contentHash,
          title: b.title,
          authors: b.authors ?? undefined,
          language: b.language ?? undefined,
          format: b.format,
          mime: b.mime,
          sizeBytes: b.sizeBytes,
          filename: b.filename,
          description: b.hiveDescription ?? undefined,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          hiveId: b.hiveId ?? undefined,
          coverUrl:
            b.hiveCover ??
            b.hiveThumbnail ??
            (b.coverPath ? `/library/covers/${b.contentHash}` : undefined),
          // `coverUrl`'s local form needs a session cookie, which a service-auth
          // client does not have. This tells such a client to use
          // getPersonalBookCover instead, without breaking `coverUrl` for the
          // web and mobile clients that already read it.
          hasLocalCover: Boolean(b.coverPath),
          progress: syncProgressView(b.progressData, b.progressUpdatedAt),
          shelfIds: shelfIdsByBook.get(b.id) ?? [],
        })),
        total: Number(counted.total),
        cursor: nextCursor,
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

      const book = await ctx.db
        .selectFrom("personal_book")
        .leftJoin("hive_book", "personal_book.hiveId", "hive_book.id")
        .select([
          "personal_book.contentHash",
          "personal_book.hiveId",
          "personal_book.title",
          "personal_book.authors",
          "personal_book.language",
          "personal_book.format",
          "personal_book.mime",
          "personal_book.coverPath",
          "personal_book.sizeBytes",
          "personal_book.createdAt",
          "personal_book.updatedAt",
          "hive_book.cover as hiveCover",
          "hive_book.thumbnail as hiveThumbnail",
        ])
        .where("personal_book.userDid", "=", userDid)
        .where("personal_book.contentHash", "=", contentHash)
        .executeTakeFirst();

      if (!book) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }

      return json({
        book: {
          contentHash: book.contentHash,
          title: book.title,
          authors: book.authors ?? undefined,
          language: book.language ?? undefined,
          format: book.format,
          mime: book.mime,
          sizeBytes: book.sizeBytes,
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
          hiveId: book.hiveId ?? undefined,
          coverUrl:
            book.hiveCover ??
            book.hiveThumbnail ??
            (book.coverPath ? `/library/covers/${book.contentHash}` : undefined),
        },
      });
    },
  });

  // The XRPC equivalent of GET /opds/books/:hash/download.
  //
  // Returns a bare `Response` rather than `json(...)`: the lexicon declares a
  // blob output, so the router passes whatever we return straight through and
  // sets no headers of its own — this handler owns all of them.
  router.addQuery(BuzzBookhiveGetPersonalBookFile, {
    auth: "identity",
    async handler({ request, params: _params }) {
      const ctx = getCtx();
      const { did: userDid } = getAuth();
      const { contentHash } = _params as BuzzBookhiveGetPersonalBookFile.$params;

      // `streamPersonalBook` answers the conditional request itself, before it
      // opens the file. This route must not lean on hono's `etag()` for the
      // 304: that middleware buffers a whole body through a digest, which is
      // exactly what a 100 MB download must never do.
      const download = await streamPersonalBook(
        ctx.db,
        userDid,
        contentHash,
        request.headers.get("if-none-match"),
      );
      // 404 rather than 403 for someone else's book — don't leak existence.
      if (!download) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Book not found" });
      }
      if (download.notModified) {
        return new Response(null, { status: 304, headers: download.headers });
      }
      return new Response(download.stream, { status: 200, headers: download.headers });
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
          // Set our own ETag: hono's `etag()` only digests (and so buffers) a
          // response that doesn't already carry one, and this gets conditional
          // requests answered for free.
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

      // No extracted cover, but the book is linked to a catalog entry: hand the
      // client the public image proxy. Absolute, so a non-browser client can
      // follow it without knowing our origin, and public, so nothing leaks.
      if (book.hiveId) {
        // Built by hand rather than with `Response.redirect`, whose headers are
        // *immutable*: the downstream `Cache-Control` middleware and the nitro
        // response hook both set headers on the final Response, and doing that
        // to an immutable guard throws a TypeError — turning a 302 into a 500.
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

  // The root call for a catalog client: everything GET /opds renders, in one
  // request — shelves with their counts, the library total, and storage usage.
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

  // The blob-input twin of POST /library/upload. Both are thin adapters over
  // `uploadPersonalBook`; the body streams straight to disk from here, so an
  // oversized or malformed upload is never materialised in memory.
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
          // The lexicon declares a blob input, so atcute leaves the body alone
          // and types it as a stream for us.
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

      // Best-effort: the row is already gone, so the book is out of the library
      // and out of the quota either way. Failing the request here would 500 an
      // otherwise-successful delete and send the client into retrying a delete
      // that now 404s.
      await removeBookDir(userDid, contentHash).catch((err: unknown) => {
        ctx.addWideEventContext({
          personal_book_rm: "failed",
          error: { message: err instanceof Error ? err.message : String(err) },
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
          title: hiveBook.title,
          authors: hiveBook.authors,
          updatedAt: now,
        })
        .where("userDid", "=", userDid)
        .where("contentHash", "=", contentHash)
        .execute();

      // Also update any matching sync_document with the same contentHash
      await ctx.db
        .updateTable("sync_document")
        .set({ hiveId: hiveBook.id })
        .where("userDid", "=", userDid)
        .where("documentHash", "=", contentHash)
        .execute();

      // Mark the book as owned if the user has it in their library
      await ctx.db
        .updateTable("user_book")
        .set({ owned: 1 })
        .where("userDid", "=", userDid)
        .where("hiveId", "=", hiveBook.id)
        .where("owned", "=", 0)
        .execute();

      return json({
        book: {
          contentHash,
          title: hiveBook.title,
          authors: hiveBook.authors ?? undefined,
          language: book.language ?? undefined,
          format: book.format,
          mime: book.mime,
          sizeBytes: book.sizeBytes,
          createdAt: book.createdAt,
          updatedAt: now,
          hiveId: hiveBook.id,
          coverUrl:
            hiveBook.cover ??
            hiveBook.thumbnail ??
            (book.coverPath ? `/library/covers/${contentHash}` : undefined),
        },
      });
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

      // linkPersonalBook propagates the hiveId onto the matching sync_document;
      // unlinking has to undo that too, or the document stays falsely linked.
      await ctx.db
        .updateTable("sync_document")
        .set({ hiveId: null })
        .where("userDid", "=", userDid)
        .where("documentHash", "=", contentHash)
        .execute();

      return json({
        book: {
          contentHash,
          title: book.title,
          authors: book.authors ?? undefined,
          language: book.language ?? undefined,
          format: book.format,
          mime: book.mime,
          sizeBytes: book.sizeBytes,
          createdAt: book.createdAt,
          updatedAt: now,
          coverUrl: book.coverPath ? `/library/covers/${contentHash}` : undefined,
        },
      });
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

      const row = await ctx.db
        .selectFrom("sync_document")
        .select(["documentHash", "progressData"])
        .where("userDid", "=", userDid)
        .where("provider", "=", "kosync")
        .where("documentHash", "=", contentHash)
        .executeTakeFirst();

      if (!row) {
        throw new XRPCError({ status: 404, error: "NotFound", message: "Document not found" });
      }

      const data: SyncProgressData = JSON.parse(row.progressData);
      return json({
        document: row.documentHash,
        progress: data.progress,
        percentage: String(data.percentage),
        device: data.device,
        device_id: data.device_id,
        timestamp: data.timestamp,
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

      const now = new Date().toISOString();
      const timestamp = Math.floor(Date.now() / 1000);
      const filename = metadata?.filename ?? null;
      const title = metadata?.title ?? null;
      const authors = metadata?.authors ?? null;

      const progressData: SyncProgressData = {
        progress,
        percentage,
        device,
        device_id,
        timestamp,
      };

      const existing = await ctx.db
        .selectFrom("sync_document")
        .select(["id", "hiveId"])
        .where("userDid", "=", userDid)
        .where("provider", "=", "kosync")
        .where("documentHash", "=", document)
        .executeTakeFirst();

      if (existing) {
        await ctx.db
          .updateTable("sync_document")
          .set({
            progressData: JSON.stringify(progressData),
            updatedAt: now,
            ...(filename != null ? { filename, filenameKey: filenameKey(filename) } : {}),
            ...(title != null ? { title } : {}),
            ...(authors != null ? { authors } : {}),
          })
          .where("id", "=", existing.id)
          .execute();
      } else {
        await ctx.db
          .insertInto("sync_document")
          .values({
            userDid,
            provider: "kosync",
            documentHash: document,
            hiveId: null,
            filename,
            filenameKey: filenameKey(filename),
            title,
            authors,
            progressData: JSON.stringify(progressData),
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }

      let hiveId = existing?.hiveId ?? null;

      // Unconditional, and resolved against the user's uploaded files — see the
      // same call in src/routes/sync/kosync.ts.
      if (!hiveId) {
        hiveId = await matchSyncDocumentForUser(ctx.db, userDid, {
          documentHash: document,
          title,
          authors,
          filename,
        });
        if (hiveId) {
          await ctx.db
            .updateTable("sync_document")
            .set({ hiveId })
            .where("userDid", "=", userDid)
            .where("provider", "=", "kosync")
            .where("documentHash", "=", document)
            // Fill only an empty link — see the same guard in
            // src/routes/sync/kosync.ts for why.
            .where("hiveId", "is", null)
            .execute();
        }
      }

      if (hiveId) {
        await bridgeProgressToUserBook(ctx.db, ctx.kv, userDid, hiveId as HiveIdType, percentage);
      }

      return json({ status: "success" });
    },
  });

  router.addQuery(BuzzBookhiveListSyncDocuments, {
    auth: "identity",
    async handler() {
      const ctx = getCtx();
      const { did: userDid } = getAuth();

      const rows = await ctx.db
        .selectFrom("sync_document")
        .select(["documentHash", "progressData", "filename", "title", "authors", "hiveId"])
        .where("userDid", "=", userDid)
        .where("provider", "=", "kosync")
        .orderBy("updatedAt", "desc")
        .execute();

      const documents = rows.map((row) => {
        const data: SyncProgressData = JSON.parse(row.progressData);
        return {
          documentHash: row.documentHash,
          progress: data.progress,
          percentage: String(data.percentage),
          device: data.device,
          device_id: data.device_id,
          filename: row.filename ?? undefined,
          title: row.title ?? undefined,
          authors: row.authors ?? undefined,
          // The NO_HIVE_MATCH sentinel ("bk_none") records that the user
          // dismissed this document; never surface it as a hiveId a client
          // would resolve to /books/bk_none.
          hiveId: !row.hiveId || row.hiveId === NO_HIVE_MATCH ? undefined : row.hiveId,
          dismissed: row.hiveId === NO_HIVE_MATCH,
          timestamp: data.timestamp,
        };
      });

      return json({ documents });
    },
  });

  app.all("/xrpc/*", (c) => xrpcContextStorage.run(c.get("ctx"), () => router.fetch(c.req.raw)));
}
