import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { z } from "zod";

import type { Did } from "@atcute/lexicons";
import { getSessionConfig } from "../auth/router";
import type { AppEnv, Session } from "../context";
import { Error as ErrorPage } from "../pages/error";
import { SettingsPage } from "../pages/settings";
import { deleteAccountData } from "../utils/deleteAccount";
import { getAvailableLanguages } from "../utils/getLanguages";
import { currentSyncPassword, rotateSyncToken } from "../middleware/sync-auth";
import { bridgeProgressToUserBook } from "../utils/syncBridge";
import { NO_HIVE_MATCH } from "../utils/syncMatching";
import type { HiveId, SyncProgressData } from "../types";

const app = new Hono<AppEnv>()
  .get("/", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.redirect("/login");
    const { db, kv } = c.get("ctx");
    const [profile, languages] = await Promise.all([
      c.get("ctx").getProfile(),
      getAvailableLanguages(db, kv),
    ]);
    const handle = profile?.handle ?? agent.did;
    return c.render(<SettingsPage handle={handle} languages={languages} />, {
      title: "Settings",
    });
  })
  .post(
    "/delete-account",
    zValidator("form", z.object({ confirmHandle: z.string() })),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        c.status(401);
        return c.render(
          <ErrorPage
            message="Invalid Session"
            description="Login to manage your account"
            statusCode={401}
          />,
          { title: "Unauthorized" },
        );
      }

      const { confirmHandle } = c.req.valid("form");
      const profile = await c.get("ctx").getProfile();
      const expectedHandle = profile?.handle ?? agent.did;

      if (confirmHandle !== expectedHandle) {
        c.status(400);
        return c.render(
          <ErrorPage
            message="Handle does not match"
            description="Please type your handle exactly to confirm deletion"
            statusCode={400}
          />,
          { title: "Confirmation Failed" },
        );
      }

      try {
        c.get("ctx").addWideEventContext({ account_delete: "started", userDid: agent.did });

        await deleteAccountData({ agent, db: c.get("ctx").db });

        c.get("ctx").addWideEventContext({ account_delete: "completed" });
      } catch (e) {
        c.set("requestError", e);
        c.get("ctx").addWideEventContext({
          account_delete: "failed",
          error: (e as Error).message,
        });
        c.status(500);
        return c.render(
          <ErrorPage
            message="Failed to delete account"
            description="Something went wrong while deleting your data. Please try again."
            statusCode={500}
          />,
          { title: "Error" },
        );
      }

      // Revoke OAuth and destroy session
      try {
        await c.get("ctx").oauthClient.revoke(agent.did as Did);
      } catch {
        // ignore revoke errors
      }
      const session = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());
      session.destroy();

      return c.redirect("/");
    },
  );

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
// (if any) for display in Settings.
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
    // The sentinel means "the user says this isn't on BookHive" — surface it as
    // a dismissed flag rather than a hiveId nothing can resolve (/books/bk_none).
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
    await bridgeProgressToUserBook(db, kv, agent.did, hiveId as HiveId, percentage);

    return c.json({ hiveId: book.id, bookTitle: book.title });
  },
);

export default app;
