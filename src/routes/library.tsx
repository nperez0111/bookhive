import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
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
import { ensureDir, personalBookDir, bookFilePath, coverFilePath } from "../utils/personalLibrary";
import type { HiveId, SyncProgressData } from "../types";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const app = new Hono<AppEnv>()
  .get("/", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.redirect("/login");
    const profile = await c.get("ctx").getProfile();
    const handle = profile?.handle ?? agent.did;
    return c.render(<LibraryPage handle={handle} />, {
      title: "Personal Library",
    });
  })
  .post("/upload", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.json({ error: "Unauthorized" }, 401);

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
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

    return c.redirect("/library");
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
    return {
      document: row.document,
      title: row.title,
      authors: row.authors,
      filename: row.filename,
      percentage,
      device,
      updatedAt: row.updatedAt,
      hiveId: row.hiveId,
      bookTitle: row.bookTitle,
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

export default app;
