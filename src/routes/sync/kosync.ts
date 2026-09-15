import { Hono } from "hono";
import type { AppEnv } from "../../context";
import { syncAuthMiddleware } from "../../middleware/sync-auth";
import { recordSyncProgress } from "../../data/syncBridge";
import { getSyncDocument, listSyncDocuments } from "../../data/syncDocuments";

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

  await recordSyncProgress({
    db,
    kv,
    userDid,
    document,
    progress,
    percentage,
    device,
    deviceId: device_id,
    metadata,
  });

  return c.json({ status: "success" });
});

app.get("/syncs/progress/:document", syncAuthMiddleware, async (c) => {
  const userDid = c.get("syncUserDid");
  const document = c.req.param("document");
  const { db } = c.get("ctx");

  const doc = await getSyncDocument({ db, userDid, document });
  if (!doc) {
    return c.json({ status: "not found" }, 404);
  }

  return c.json({
    document: doc.document,
    progress: doc.progress,
    percentage: doc.percentage,
    device: doc.device,
    device_id: doc.deviceId,
    timestamp: doc.timestamp,
  });
});

app.get("/syncs/documents", syncAuthMiddleware, async (c) => {
  const userDid = c.get("syncUserDid");
  const { db } = c.get("ctx");

  const documents = (await listSyncDocuments({ db, userDid })).map((doc) => ({
    document: doc.document,
    progress: doc.progress,
    // A number here, a string over XRPC — each is the correct wire format for its own protocol.
    percentage: doc.percentage,
    device: doc.device,
    device_id: doc.deviceId,
    filename: doc.filename,
    title: doc.title,
    authors: doc.authors,
    timestamp: doc.timestamp,
  }));

  return c.json({ documents });
});

export default app;
