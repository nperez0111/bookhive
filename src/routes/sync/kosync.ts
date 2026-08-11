import { Hono } from "hono";
import type { AppEnv } from "../../context";
import { syncAuthMiddleware } from "../../middleware/sync-auth";
import { matchSyncDocumentForUser } from "../../utils/syncMatching";
import { filenameKey } from "../../utils/filenameMatching";
import { bridgeProgressToUserBook } from "../../utils/syncBridge";
import type { HiveId, SyncProgressData } from "../../types";

type SyncEnv = AppEnv & { Variables: { syncUserDid: string } };

const app = new Hono<SyncEnv>();

app.post("/users/create", (c) => {
  return c.json(
    {
      message:
        "Registration is managed through BookHive. Log in at bookhive.buzz and visit Settings to set up KOReader sync.",
    },
    403,
  );
});

app.get("/users/auth", syncAuthMiddleware, (c) => {
  return c.json({ authorized: "OK" });
});

app.put("/syncs/progress", syncAuthMiddleware, async (c) => {
  const userDid = c.get("syncUserDid");
  const { db, kv } = c.get("ctx");

  let body: {
    document: string;
    progress: string;
    percentage: number;
    device: string;
    device_id: string;
    metadata?: { filename?: string; title?: string; authors?: string };
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Invalid JSON body" }, 400);
  }

  const { document, progress, percentage, device, device_id, metadata } = body;

  if (!document || !progress || percentage === undefined || !device || !device_id) {
    return c.json({ message: "Missing required fields" }, 400);
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

  const existing = await db
    .selectFrom("sync_document")
    .select(["id", "hiveId"])
    .where("userDid", "=", userDid)
    .where("provider", "=", "kosync")
    .where("documentHash", "=", document)
    .executeTakeFirst();

  if (existing) {
    await db
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
    await db
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

  // Unconditional: a default-configured KOReader sends no metadata at all, and
  // `matchSyncDocumentForUser` resolves those from the uploaded file the
  // document hash points at. Gating this on the client having sent something is
  // what kept both that case and the filename-only case unmatchable.
  if (!hiveId) {
    hiveId = await matchSyncDocumentForUser(db, userDid, {
      documentHash: document,
      title,
      authors,
      filename,
    });
    if (hiveId) {
      await db
        .updateTable("sync_document")
        .set({ hiveId })
        .where("userDid", "=", userDid)
        .where("provider", "=", "kosync")
        .where("documentHash", "=", document)
        // Only fill a genuinely empty link. `hiveId` was read at the top of the
        // handler and the match takes a few queries, so a concurrent request —
        // or the user linking by hand in another tab — can land in between;
        // production runs three worker processes, so this is not theoretical.
        // It also can't clobber the NO_HIVE_MATCH dismissal sentinel.
        .where("hiveId", "is", null)
        .execute();
    }
  }

  if (hiveId) {
    await bridgeProgressToUserBook(db, kv, userDid, hiveId as HiveId, percentage);
  }

  return c.json({ status: "success" });
});

app.get("/syncs/progress/:document", syncAuthMiddleware, async (c) => {
  const userDid = c.get("syncUserDid");
  const document = c.req.param("document");
  const { db } = c.get("ctx");

  const row = await db
    .selectFrom("sync_document")
    .select("progressData")
    .where("userDid", "=", userDid)
    .where("provider", "=", "kosync")
    .where("documentHash", "=", document)
    .executeTakeFirst();

  if (!row) {
    return c.json({ status: "not found" }, 404);
  }

  const data: SyncProgressData = JSON.parse(row.progressData);
  return c.json({
    document,
    progress: data.progress,
    percentage: data.percentage,
    device: data.device,
    device_id: data.device_id,
    timestamp: data.timestamp,
  });
});

app.get("/syncs/documents", syncAuthMiddleware, async (c) => {
  const userDid = c.get("syncUserDid");
  const { db } = c.get("ctx");

  const rows = await db
    .selectFrom("sync_document")
    .select(["documentHash", "progressData", "filename", "title", "authors"])
    .where("userDid", "=", userDid)
    .where("provider", "=", "kosync")
    .orderBy("updatedAt", "desc")
    .execute();

  const documents = rows.map((row) => {
    const data: SyncProgressData = JSON.parse(row.progressData);
    return {
      document: row.documentHash,
      progress: data.progress,
      percentage: data.percentage,
      device: data.device,
      device_id: data.device_id,
      filename: row.filename,
      title: row.title,
      authors: row.authors,
      timestamp: data.timestamp,
    };
  });

  return c.json({ documents });
});

export default app;
