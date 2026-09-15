import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { AppEnv } from "../context";
import { LibraryPage } from "../pages/library";
import { syncCredentialRoutes } from "./syncCredentials";
import { bridgeProgressToUserBook } from "../data/syncBridge";
import { updateBookRecord } from "../services/getBook";
import { formatBytes } from "../lib/formatBytes";
import { READING } from "../constants";
import { etagMatches, streamPersonalBook, MAX_PERSONAL_BOOK_BYTES } from "../data/personalLibrary";
import { uploadPersonalBook } from "../services/uploadPersonalBook";
import { NO_HIVE_MATCH } from "../data/syncMatching";
import { listSyncDocuments } from "../data/syncDocuments";
import type { HiveId, SyncProgressData } from "../types";
import { jsonUnauthorized } from "./authResponse";

const MAX_FILE_SIZE = MAX_PERSONAL_BOOK_BYTES;

/**
 * Headroom for multipart headers when checking Content-Length against the
 * per-file limit. Generous on purpose — this is a cheap early reject; the
 * core enforces the real cap on the file itself.
 */
const MULTIPART_SLACK = 64 * 1024;

/**
 * The `?error=` codes the upload adapter redirects a browser back with. Closed
 * set, not a free string — this is the one input on the page that comes from
 * the URL, and anything outside it is a hand-crafted link forging an error
 * banner on another user's library.
 */
const UPLOAD_ERROR_CODES = [
  "TooLarge",
  "QuotaExceeded",
  "UnsupportedFormat",
  "AlreadyExists",
  "EmptyFile",
  "NoFile",
  "Busy",
] as const;

const app = new Hono<AppEnv>()
  .get(
    "/",
    // `.catch` rather than a hard 400: an unrecognised code means a stale or
    // hand-edited link, and dropping the banner is a better answer than
    // refusing to render the user's library.
    zValidator(
      "query",
      z.object({ error: z.enum(UPLOAD_ERROR_CODES).optional().catch(undefined) }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) return c.redirect("/login");
      const profile = await c.get("ctx").getProfile();
      const handle = profile?.handle ?? agent.did;
      const { db } = c.get("ctx");

      // Drives the empty-vs-populated layout: with nothing uploaded and nothing
      // synced there is no library to manage, so the page explains itself and
      // puts setup inline instead of behind modals.
      const [books, documents] = await Promise.all([
        db
          .selectFrom("personal_book")
          .select((eb) => eb.fn.countAll<number>().as("total"))
          .where("userDid", "=", agent.did)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom("sync_document")
          .select((eb) => eb.fn.countAll<number>().as("total"))
          .where("userDid", "=", agent.did)
          .executeTakeFirstOrThrow(),
      ]);

      return c.render(
        <LibraryPage
          handle={handle}
          bookCount={Number(books.total)}
          syncDocCount={Number(documents.total)}
          uploadError={c.req.valid("query").error}
        />,
        { title: "Ebooks & Devices" },
      );
    },
  )
  // Thin adapter over `uploadPersonalBook` — the same core the XRPC procedure
  // calls; this owns only content negotiation and status-code mapping.
  //
  // No `bodyLimit()` middleware — it only checks Content-Length and buffers
  // chunked bodies in full before this handler even runs, so the core caps
  // size while streaming to disk instead.
  .post("/upload", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      // Upload-specific wording: the iOS app renders `payload.error` verbatim,
      // so a bare "Unauthorized" here would short-circuit its own re-login copy.
      return jsonUnauthorized(c, "Your session expired. Sign in again to upload.");
    }

    // The browser posts a plain <form> and wants to land back on the library;
    // the mobile app posts the same multipart body but needs the created record
    // (and a real status on duplicates) rather than a redirect to HTML.
    const wantsJson = c.req.header("accept")?.includes("application/json") ?? false;
    const fail = (status: ContentfulStatusCode, code: string, error: string, extra = {}) =>
      wantsJson
        ? c.json({ error, code, ...extra }, status)
        : c.redirect(`/library?error=${encodeURIComponent(code)}`);

    // `formData()` below still materialises the whole File in memory — Bun/hono
    // expose no incremental multipart API — so reject an obviously oversized
    // body before parsing it.
    const declaredTotal = Number(c.req.header("content-length"));
    if (Number.isFinite(declaredTotal) && declaredTotal > MAX_FILE_SIZE + MULTIPART_SLACK) {
      return fail(413, "TooLarge", "File exceeds 100 MB limit");
    }

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return fail(400, "NoFile", "No file provided");
    }

    const { db, kv } = c.get("ctx");
    const result = await uploadPersonalBook({
      db,
      kv,
      userDid: agent.did,
      filename: file.name,
      source: { kind: "stream", body: file.stream(), declaredLength: file.size },
    });

    if (result.ok) {
      // Same shape as getPersonalLibrary#personalBookView so clients have one
      // book type for both the list and the upload response.
      return wantsJson ? c.json({ book: result.book }) : c.redirect("/library");
    }

    switch (result.reason) {
      case "too-large":
        return fail(413, "TooLarge", "File exceeds 100 MB limit");
      case "quota-exceeded":
        return fail(
          413,
          "QuotaExceeded",
          `Library full — ${formatBytes(result.usedBytes)} of ${formatBytes(result.quotaBytes)} used. Delete a book to free space.`,
          { usedBytes: result.usedBytes, quotaBytes: result.quotaBytes },
        );
      case "unsupported-format":
        return fail(400, "UnsupportedFormat", "Unsupported file format");
      case "duplicate":
        return fail(409, "AlreadyExists", "This book is already in your library");
      case "empty":
        return fail(400, "EmptyFile", "The file is empty");
      case "busy":
        return fail(503, "Busy", "Server is busy — try again in a moment");
    }
  });

app.get("/covers/:hash", async (c) => {
  const userDid = await c.get("ctx").getSessionDid();
  if (!userDid) return jsonUnauthorized(c);
  const { db } = c.get("ctx");

  const book = await db
    .selectFrom("personal_book")
    .select(["coverPath", "coverMime"])
    .where("userDid", "=", userDid)
    .where("contentHash", "=", c.req.param("hash"))
    .executeTakeFirst();

  if (!book?.coverPath) return c.notFound();

  const file = Bun.file(book.coverPath);
  if (!(await file.exists())) return c.notFound();

  // Streamed, not buffered — the whole cover would otherwise land in heap on a
  // synchronous, three-process server for a file we're about to hand straight
  // to the socket.
  //
  // The ETag matters because `/library/covers/` is outside ETAG_EXCLUDED_PREFIXES,
  // so hono's `etag()` would otherwise buffer the body again to digest it; the
  // content hash makes the validator free to compute.
  const etag = `"${c.req.param("hash")}-cover"`;
  const headers = {
    "Content-Type": book.coverMime || "image/jpeg",
    "Cache-Control": "private, max-age=86400",
    "Content-Encoding": "identity",
    ETag: etag,
  };
  if (etagMatches(c.req.header("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(file.stream(), { headers });
});

// Session-authenticated download for the web UI. OPDS serves the same bytes at
// /opds/books/:hash/download/{name}.ext, but that route is behind HTTP Basic
// auth, which a logged-in browser does not have.
app.get("/books/:hash/download", async (c) => {
  const userDid = await c.get("ctx").getSessionDid();
  if (!userDid) return jsonUnauthorized(c);

  const download = await streamPersonalBook(
    c.get("ctx").db,
    userDid,
    c.req.param("hash"),
    c.req.header("if-none-match"),
    { range: c.req.header("range"), ifRange: c.req.header("if-range") },
  );
  if (!download) return c.notFound();
  // A bare Response rather than `c.body()`: hono types the latter's status
  // against ContentfulStatusCode, which excludes the 304 this can return.
  // Middleware that adjusts headers after `next()` reads `c.res` either way.
  return new Response(download.stream, {
    status: download.status,
    headers: download.headers,
  });
});

app.get("/shelves", async (c) => {
  const userDid = await c.get("ctx").getSessionDid();
  if (!userDid) return jsonUnauthorized(c);
  const { db } = c.get("ctx");

  const rows = await db
    .selectFrom("personal_shelf")
    .select(["id", "name", "description", "createdAt", "updatedAt"])
    .where("userDid", "=", userDid)
    .orderBy("name", "asc")
    .execute();

  const counts = await db
    .selectFrom("personal_shelf_item")
    .innerJoin("personal_shelf", "personal_shelf.id", "personal_shelf_item.shelfId")
    .select(["personal_shelf_item.shelfId", db.fn.count("personal_shelf_item.id").as("count")])
    .where("personal_shelf.userDid", "=", userDid)
    .groupBy("personal_shelf_item.shelfId")
    .execute();

  const countMap = new Map(counts.map((r) => [r.shelfId, Number(r.count)]));

  return c.json({
    shelves: rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? undefined,
      bookCount: countMap.get(s.id) ?? 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  });
});

app.route("/sync", syncCredentialRoutes);

app.get("/sync/documents", async (c) => {
  const agent = await c.get("ctx").getSessionAgent();
  if (!agent) return jsonUnauthorized(c);
  const { db } = c.get("ctx");

  const documents = (await listSyncDocuments({ db, userDid: agent.did })).map((doc) => ({
    document: doc.document,
    title: doc.title,
    authors: doc.authors,
    filename: doc.filename,
    percentage: doc.percentage,
    device: doc.device,
    updatedAt: doc.updatedAt,
    hiveId: doc.hiveId,
    bookTitle: doc.bookTitle,
    dismissed: doc.dismissed,
    hasFile: doc.hasFile,
  }));

  return c.json({ documents });
});

// Manually links a synced document to a book, bridging its stored progress onto
// user_book — mirrors what an exact auto-match would have done.
app.post(
  "/sync/link",
  zValidator("json", z.object({ document: z.string().min(1), hiveId: z.string().min(1) })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return jsonUnauthorized(c);
    const { db, kv } = c.get("ctx");
    const { document, hiveId } = c.req.valid("json");

    const row = await db
      .selectFrom("sync_document")
      .select(["id", "progressData"])
      .where("userDid", "=", agent.did)
      .where("documentHash", "=", document)
      .executeTakeFirst();
    if (!row) return c.json({ error: "Document not found" }, 404);

    const book = await db
      .selectFrom("hive_book")
      .select(["id", "title"])
      .where("id", "=", hiveId as HiveId)
      .executeTakeFirst();
    if (!book) return c.json({ error: "Book not found" }, 404);

    await db
      .updateTable("sync_document")
      .set({ hiveId: hiveId as HiveId })
      .where("id", "=", row.id)
      .execute();

    let percentage = 0;
    try {
      percentage = (JSON.parse(row.progressData) as SyncProgressData).percentage ?? 0;
    } catch {
      // ignore malformed progress
    }

    // Create the user_book if missing, with "reading" status, so it shows up on their profile/home.
    const existingUserBook = await db
      .selectFrom("user_book")
      .select("uri")
      .where("userDid", "=", agent.did)
      .where("hiveId", "=", hiveId as HiveId)
      .executeTakeFirst();

    if (!existingUserBook) {
      const ctx = c.get("ctx");
      const percent = Math.max(0, Math.min(100, Math.round(percentage * 100)));
      await updateBookRecord({
        ctx,
        agent,
        hiveId: hiveId as HiveId,
        updates: {
          status: READING,
          bookProgress: { percent, updatedAt: new Date().toISOString() },
          owned: true,
        },
      });
      // updateBookRecord wrote to PDS + local DB, so bridge is already done
    } else {
      await bridgeProgressToUserBook(db, kv, agent.did, hiveId as HiveId, percentage);
    }

    return c.json({ hiveId: book.id, bookTitle: book.title });
  },
);

// Writes the NO_HIVE_MATCH sentinel into hiveId — records the user's "no match"
// assertion and stops the auto-matcher retrying on every progress push.
app.post(
  "/sync/dismiss",
  zValidator("json", z.object({ document: z.string().min(1), dismissed: z.boolean() })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return jsonUnauthorized(c);
    const { db } = c.get("ctx");
    const { document, dismissed } = c.req.valid("json");

    const result = await db
      .updateTable("sync_document")
      .set({ hiveId: dismissed ? NO_HIVE_MATCH : null })
      .where("userDid", "=", agent.did)
      .where("documentHash", "=", document)
      // Only ever toggle between "unknown" and "dismissed" — never clobber a
      // real link the user (or the auto-matcher) established.
      .where((eb) => eb.or([eb("hiveId", "is", null), eb("hiveId", "=", NO_HIVE_MATCH)]))
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      return c.json({ error: "Document not found or already linked" }, 404);
    }
    return c.json({ dismissed });
  },
);

// Lets the user name a document that arrived with no embedded metadata —
// otherwise it shows up as "Untitled document" forever.
app.post(
  "/sync/rename",
  zValidator("json", z.object({ document: z.string().min(1), title: z.string().min(1).max(300) })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return jsonUnauthorized(c);
    const { db } = c.get("ctx");
    const { document, title } = c.req.valid("json");

    const result = await db
      .updateTable("sync_document")
      .set({ title, updatedAt: new Date().toISOString() })
      .where("userDid", "=", agent.did)
      .where("documentHash", "=", document)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      return c.json({ error: "Document not found" }, 404);
    }
    return c.json({ title });
  },
);

// Deliberately scoped to `sync_document` — if the document was linked, the
// progress already bridged onto `user_book` is the user's own BookHive record
// (mirrored to their PDS), so it isn't ours to delete here.
app.post(
  "/sync/delete",
  zValidator("json", z.object({ document: z.string().min(1) })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return jsonUnauthorized(c);
    const { db } = c.get("ctx");
    const { document } = c.req.valid("json");

    const result = await db
      .deleteFrom("sync_document")
      .where("userDid", "=", agent.did)
      .where("documentHash", "=", document)
      .executeTakeFirst();

    if (Number(result.numDeletedRows) === 0) {
      return c.json({ error: "Document not found" }, 404);
    }
    return c.json({ deleted: true });
  },
);

export default app;
