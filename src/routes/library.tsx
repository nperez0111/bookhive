import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { AppEnv } from "../context";
import { LibraryPage } from "../pages/library";
import { currentSyncPassword, rotateSyncToken } from "../middleware/sync-auth";
import { bridgeProgressToUserBook } from "../utils/syncBridge";
import { updateBookRecord } from "../utils/getBook";
import { READING } from "../constants";
import { streamPersonalBook, MAX_PERSONAL_BOOK_BYTES } from "../utils/personalLibrary";
import { uploadPersonalBook } from "../utils/uploadPersonalBook";
import { NO_HIVE_MATCH, SAME_BOOK_FILE } from "../utils/syncMatching";
import type { HiveId, SyncProgressData } from "../types";

const MAX_FILE_SIZE = MAX_PERSONAL_BOOK_BYTES;

/**
 * Headroom for multipart part headers and boundaries when checking the request's
 * total `Content-Length` against the per-file limit. Generous on purpose — this
 * is a cheap early reject, and the core enforces the real cap on the file itself.
 */
const MULTIPART_SLACK = 64 * 1024;

/** Human-readable byte count for user-facing quota messages. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * The `?error=` codes the upload adapter redirects a browser back with. Closed
 * set rather than a free string: it is the one input on this page that comes
 * from the URL, and anything outside the list is someone hand-crafting a link
 * to put an error banner on another user's library.
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
        { title: "Personal Library" },
      );
    },
  )
  // Thin adapter over `uploadPersonalBook` — the same core the XRPC procedure
  // calls. Everything here is transport: content negotiation and the mapping
  // from the core's discriminated result to a status code.
  //
  // Note there is no `bodyLimit()` middleware any more. It only short-circuits
  // on `Content-Length`; given a chunked body it drains the whole stream into
  // an array and rebuilds the Request, so a compliant 100 MB chunked upload was
  // buffered there *and again* by `formData()`. The core caps while streaming
  // to disk, which bounds every path at one chunk.
  .post("/upload", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.json({ error: "Unauthorized" }, 401);

    // The browser posts a plain <form> and wants to land back on the library;
    // the mobile app posts the same multipart body but needs the created record
    // (and a real status on duplicates) rather than a redirect to HTML.
    const wantsJson = c.req.header("accept")?.includes("application/json") ?? false;
    const fail = (status: ContentfulStatusCode, code: string, error: string, extra = {}) =>
      wantsJson
        ? c.json({ error, code, ...extra }, status)
        : c.redirect(`/library?error=${encodeURIComponent(code)}`);

    // The early reject `bodyLimit` used to give. `formData()` below still
    // materialises the File in native memory — Bun/hono expose no incremental
    // multipart API — so refusing an obviously oversized body before parsing it
    // is worth the two lines. MULTIPART_SLACK covers the part headers.
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

// Serve cover images for personal library books
app.get("/covers/:hash", async (c) => {
  const userDid = await c.get("ctx").getSessionDid();
  if (!userDid) return c.json({ error: "Unauthorized" }, 401);
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

  const bytes = await file.arrayBuffer();
  return new Response(bytes, {
    headers: {
      "Content-Type": book.coverMime || "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
      "Content-Encoding": "identity",
    },
  });
});

// Session-authenticated download for the web UI. OPDS serves the same bytes at
// /opds/books/:hash/download/{name}.ext, but that route is behind HTTP Basic
// auth, which a logged-in browser does not have.
app.get("/books/:hash/download", async (c) => {
  const userDid = await c.get("ctx").getSessionDid();
  if (!userDid) return c.json({ error: "Unauthorized" }, 401);

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
  if (!userDid) return c.json({ error: "Unauthorized" }, 401);
  const { db } = c.get("ctx");

  const rows = await db
    .selectFrom("personal_shelf")
    .select(["id", "name", "description", "createdAt", "updatedAt"])
    .where("userDid", "=", userDid)
    .orderBy("name", "asc")
    .execute();

  // Get book counts per shelf in a single query
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

app.get("/sync/password", async (c) => {
  const agent = await c.get("ctx").getSessionAgent();
  if (!agent) return c.json({ error: "Unauthorized" }, 401);
  const password = await currentSyncPassword(c.get("ctx").kv, agent.did);
  return c.json({ password });
});

app.post("/sync/rotate", async (c) => {
  const agent = await c.get("ctx").getSessionAgent();
  if (!agent) return c.json({ error: "Unauthorized" }, 401);
  await rotateSyncToken(c.get("ctx").kv, agent.did);
  const password = await currentSyncPassword(c.get("ctx").kv, agent.did);
  return c.json({ password });
});

// Synced e-reader documents for the logged-in user, with the linked book title
// (if any) for display in the library.
app.get("/sync/documents", async (c) => {
  const agent = await c.get("ctx").getSessionAgent();
  if (!agent) return c.json({ error: "Unauthorized" }, 401);
  const { db } = c.get("ctx");

  const rows = await db
    .selectFrom("sync_document")
    .leftJoin("hive_book", "hive_book.id", "sync_document.hiveId")
    .select([
      "sync_document.documentHash as document",
      "sync_document.title as title",
      "sync_document.authors as authors",
      "sync_document.filename as filename",
      "sync_document.progressData as progressData",
      "sync_document.updatedAt as updatedAt",
      "sync_document.hiveId as hiveId",
      "hive_book.title as bookTitle",
    ])
    // A document we hold the file for is the same book: the library grid
    // renders it, so the sync sections must not claim it too. An EXISTS rather
    // than a join because more than one upload can match one document (see
    // SAME_BOOK_FILE) and a join would list the document once per match.
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom("personal_book")
            .select("personal_book.id")
            .whereRef("personal_book.userDid", "=", "sync_document.userDid")
            .where(SAME_BOOK_FILE),
        )
        .as("hasFile"),
    )
    .where("sync_document.userDid", "=", agent.did)
    .orderBy("sync_document.updatedAt", "desc")
    .execute();

  const documents = rows.map((row) => {
    let percentage = 0;
    let device: string | null = null;
    try {
      const data = JSON.parse(row.progressData) as SyncProgressData;
      percentage = data.percentage ?? 0;
      device = data.device ?? null;
    } catch {
      // ignore malformed progress
    }
    // The sentinel means "the user says this isn't on BookHive" — surface it as
    // a dismissed flag rather than a hiveId nothing can resolve.
    const dismissed = row.hiveId === NO_HIVE_MATCH;
    return {
      document: row.document,
      title: row.title,
      authors: row.authors,
      filename: row.filename,
      percentage,
      device,
      updatedAt: row.updatedAt,
      hiveId: dismissed ? null : row.hiveId,
      bookTitle: dismissed ? null : row.bookTitle,
      dismissed,
      hasFile: Boolean(row.hasFile),
    };
  });

  return c.json({ documents });
});

// Manually link a synced document to a BookHive book. Sets the document's hiveId
// and bridges its stored progress onto the user's book (optimistic write + queued
// PDS write), mirroring what an exact auto-match would have done.
app.post(
  "/sync/link",
  zValidator("json", z.object({ document: z.string().min(1), hiveId: z.string().min(1) })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.json({ error: "Unauthorized" }, 401);
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

    // Ensure the book exists in the user's BookHive library. If not, create it
    // with "reading" status so it shows up on their profile/home.
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

// Mark a synced document as having no BookHive counterpart (or undo that).
// Writes the NO_HIVE_MATCH sentinel into hiveId, which both records the user's
// assertion and stops the auto-matcher from retrying on every progress push.
app.post(
  "/sync/dismiss",
  zValidator("json", z.object({ document: z.string().min(1), dismissed: z.boolean() })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.json({ error: "Unauthorized" }, 401);
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

// Give a synced document a human-readable name. Useful for documents that
// arrive from the e-reader with no embedded metadata, which would otherwise
// show up forever as "Untitled document".
app.post(
  "/sync/rename",
  zValidator("json", z.object({ document: z.string().min(1), title: z.string().min(1).max(300) })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.json({ error: "Unauthorized" }, 401);
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

// Forget a synced document entirely, discarding the e-reader progress we hold
// for it. Deliberately scoped to `sync_document`: if the document was linked,
// the reading progress already bridged onto `user_book` is the user's own
// BookHive record (and is mirrored to their PDS), so it is not ours to delete
// here. The row reappears if the e-reader syncs that book again.
app.post(
  "/sync/delete",
  zValidator("json", z.object({ document: z.string().min(1) })),
  async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.json({ error: "Unauthorized" }, 401);
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
