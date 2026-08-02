import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type { AppEnv } from "../context";
import { LibraryPage } from "../pages/library";
import { currentSyncPassword, rotateSyncToken } from "../middleware/sync-auth";
import { bridgeProgressToUserBook } from "../utils/syncBridge";
import { updateBookRecord } from "../utils/getBook";
import { READING } from "../constants";
import {
  detectFormat,
  parseBook,
  koreaderPartialMD5,
  isUsableCover,
} from "../utils/bookMetadata/index";
import {
  ensureDir,
  personalBookDir,
  bookFilePath,
  coverFilePath,
  streamPersonalBook,
  MAX_PERSONAL_BOOK_BYTES,
} from "../utils/personalLibrary";
import { NO_HIVE_MATCH } from "../utils/syncMatching";
import type { HiveId, SyncProgressData } from "../types";

const MAX_FILE_SIZE = MAX_PERSONAL_BOOK_BYTES;

const app = new Hono<AppEnv>()
  .get("/", async (c) => {
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
      />,
      { title: "Personal Library" },
    );
  })
  .post(
    "/upload",
    // Rejects on Content-Length, and aborts the stream once the cap is passed
    // when there is none. This has to run *before* the handler because
    // `c.req.formData()` materialises the entire multipart body in native
    // memory — the `file.size` check below cannot fire until after that has
    // already happened, so on its own it bounds what we store, not what we
    // allocate.
    bodyLimit({
      maxSize: MAX_FILE_SIZE,
      onError: (c) => c.json({ error: "File exceeds 100 MB limit" }, 413),
    }),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) return c.json({ error: "Unauthorized" }, 401);

      // The browser posts a plain <form> and wants to land back on the library;
      // the mobile app posts the same multipart body but needs the created record
      // (and a real status on duplicates) rather than a redirect to HTML.
      const wantsJson = c.req.header("accept")?.includes("application/json") ?? false;

      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return c.json({ error: "No file provided" }, 400);
      }

      // Check the declared size *before* materialising the file. The check used
      // to run after `arrayBuffer()`, so rejecting an oversized upload still cost
      // a full copy of it in native memory first.
      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: "File exceeds 100 MB limit" }, 413);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > MAX_FILE_SIZE) {
        return c.json({ error: "File exceeds 100 MB limit" }, 413);
      }

      const formatInfo = detectFormat(bytes, file.name);
      if (formatInfo.format === "unknown") {
        return c.json({ error: "Unsupported file format" }, 400);
      }

      const contentHash = koreaderPartialMD5(bytes);

      const { db } = c.get("ctx");

      // Check for duplicate
      const existing = await db
        .selectFrom("personal_book")
        .select("id")
        .where("userDid", "=", agent.did)
        .where("contentHash", "=", contentHash)
        .executeTakeFirst();
      if (existing) {
        if (wantsJson) {
          return c.json({ error: "This book is already in your library" }, 409);
        }
        return c.redirect("/library");
      }

      const metadata = parseBook(bytes, file.name);

      await ensureDir(personalBookDir(agent.did, contentHash));

      const filePath = bookFilePath(agent.did, contentHash, formatInfo.ext);
      await Bun.write(filePath, bytes);

      let coverPath: string | null = null;
      let coverMime: string | null = null;
      if (metadata.cover && (await isUsableCover(metadata.cover.bytes))) {
        const cp = coverFilePath(agent.did, contentHash, metadata.cover.ext);
        await Bun.write(cp, metadata.cover.bytes);
        coverPath = cp;
        coverMime = metadata.cover.mime;
      }

      // Try to match an existing sync_document (contentHash is the KOReader partial MD5)
      let matchedHiveId: HiveId | null = null;
      const syncDoc = await db
        .selectFrom("sync_document")
        .select(["hiveId"])
        .where("userDid", "=", agent.did)
        .where("documentHash", "=", contentHash)
        .executeTakeFirst();
      if (syncDoc?.hiveId) {
        matchedHiveId = syncDoc.hiveId;
      }

      const now = new Date().toISOString();
      await db
        .insertInto("personal_book")
        .values({
          userDid: agent.did,
          contentHash,
          hiveId: matchedHiveId,
          filename: file.name,
          title: metadata.title,
          authors: metadata.authors,
          language: metadata.language || null,
          format: formatInfo.format,
          mime: formatInfo.mime,
          filePath,
          coverPath,
          coverMime,
          sizeBytes: bytes.length,
          createdAt: now,
          updatedAt: now,
        })
        .execute();

      // Mark the book as owned if auto-linked and user has it in their library
      if (matchedHiveId) {
        await db
          .updateTable("user_book")
          .set({ owned: 1 })
          .where("userDid", "=", agent.did)
          .where("hiveId", "=", matchedHiveId)
          .where("owned", "=", 0)
          .execute();
      }

      if (wantsJson) {
        // Same shape as getPersonalLibrary#personalBookView so clients have one
        // book type for both the list and the upload response.
        return c.json({
          book: {
            contentHash,
            title: metadata.title,
            authors: metadata.authors || undefined,
            language: metadata.language || undefined,
            format: formatInfo.format,
            mime: formatInfo.mime,
            sizeBytes: bytes.length,
            createdAt: now,
            updatedAt: now,
            hiveId: matchedHiveId ?? undefined,
            coverUrl: coverPath ? `/library/covers/${contentHash}` : undefined,
          },
        });
      }

      return c.redirect("/library");
    },
  );

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
// /opds/books/:hash/download, but that route is behind HTTP Basic auth, which a
// logged-in browser doesn't have.
app.get("/books/:hash/download", async (c) => {
  const userDid = await c.get("ctx").getSessionDid();
  if (!userDid) return c.json({ error: "Unauthorized" }, 401);

  const download = await streamPersonalBook(
    c.get("ctx").db,
    userDid,
    c.req.param("hash"),
    c.req.header("if-none-match"),
  );
  if (!download) return c.notFound();
  if (download.notModified) return c.body(null, 304, download.headers);

  return c.body(download.stream, 200, download.headers);
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
    // A document whose hash matches an uploaded file is the same book: the
    // library grid renders it, so the sync sections must not claim it too.
    .leftJoin("personal_book", (join) =>
      join
        .onRef("personal_book.contentHash", "=", "sync_document.documentHash")
        .onRef("personal_book.userDid", "=", "sync_document.userDid"),
    )
    .select([
      "sync_document.documentHash as document",
      "sync_document.title as title",
      "sync_document.authors as authors",
      "sync_document.filename as filename",
      "sync_document.progressData as progressData",
      "sync_document.updatedAt as updatedAt",
      "sync_document.hiveId as hiveId",
      "hive_book.title as bookTitle",
      "personal_book.id as personalBookId",
    ])
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
      hasFile: row.personalBookId != null,
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
