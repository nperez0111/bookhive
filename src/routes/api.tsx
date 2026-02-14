/**
 * JSON/form API: update-book, update-comment, follow, follow-form.
 * Mount at /api so paths are /api/update-book, etc.
 */
import * as TID from "@atcute/tid";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ids, validateMain } from "../bsky/lexicon";
import { BOOK_STATUS } from "../constants";
import type { BookProgress, HiveId } from "../types";
import { updateBookRecord } from "../utils/getBook";

const updateBookSchema = z.object({
  hiveId: z.string(),
  status: z.optional(z.string()),
  review: z.optional(z.string()),
  stars: z.optional(z.number()),
  startedAt: z.optional(
    z
      .string()
      .transform((val) => {
        if (!val || val === "") return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          return new Date(val + "T00:00:00.000Z").toISOString();
        }
        return val;
      })
      .pipe(z.string().datetime().or(z.literal(""))),
  ),
  finishedAt: z.optional(
    z
      .string()
      .transform((val) => {
        if (!val || val === "") return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          return new Date(val + "T00:00:00.000Z").toISOString();
        }
        return val;
      })
      .pipe(z.string().datetime().or(z.literal(""))),
  ),
  bookProgress: z
    .union([
      z
        .object({
          percent: z.coerce.number().int().min(0).max(100).optional(),
          totalPages: z
            .preprocess(
              (val) => (val === "" ? undefined : val),
              z.coerce.number().int().min(1),
            )
            .optional(),
          currentPage: z
            .preprocess(
              (val) => (val === "" ? undefined : val),
              z.coerce.number().int().min(1),
            )
            .optional(),
          totalChapters: z
            .preprocess(
              (val) => (val === "" ? undefined : val),
              z.coerce.number().int().min(1),
            )
            .optional(),
          currentChapter: z
            .preprocess(
              (val) => (val === "" ? undefined : val),
              z.coerce.number().int().min(1),
            )
            .optional(),
        })
        .partial()
        .refine((value) => Object.keys(value).length > 0, {
          message: "bookProgress must include at least one value",
        }),
      z.null(),
    ])
    .optional(),
});

const app = new Hono<AppEnv>()
  .post("/update-book", zValidator("json", updateBookSchema), async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.json({ success: false, message: "Invalid Session" }, 401);
    }
    const payload = c.req.valid("json");
    const { hiveId, bookProgress, ...updates } = payload;

    let normalizedProgress: BookProgress | undefined | null = bookProgress as
      | BookProgress
      | null
      | undefined;
    if (bookProgress && bookProgress !== null) {
      normalizedProgress = {
        ...bookProgress,
        updatedAt: new Date().toISOString(),
      } as BookProgress;
      if (
        normalizedProgress.currentPage &&
        normalizedProgress.totalPages &&
        normalizedProgress.currentPage > normalizedProgress.totalPages
      ) {
        throw new Error("Current page cannot exceed total pages");
      }
      if (
        normalizedProgress.currentChapter &&
        normalizedProgress.totalChapters &&
        normalizedProgress.currentChapter > normalizedProgress.totalChapters
      ) {
        throw new Error("Current chapter cannot exceed total chapters");
      }
    }
    if (normalizedProgress !== undefined) {
      (updates as Record<string, unknown>).bookProgress = normalizedProgress;
      if (!updates.status) {
        updates.status = BOOK_STATUS.READING;
      }
    }
    if (!hiveId) {
      return c.json({ success: false, message: "Invalid ID" }, 400);
    }
    const bookLockKey = "book_lock:" + agent.did;
    try {
      await c.get("ctx").kv.setItem(bookLockKey, hiveId);
      await updateBookRecord({
        ctx: c.get("ctx"),
        agent,
        hiveId: hiveId as HiveId,
        updates,
      });
      return c.json({ success: true, message: "Book updated" });
    } catch (e) {
      return c.json({ success: false, message: (e as Error).message }, 400);
    } finally {
      await c.get("ctx").kv.del(bookLockKey);
    }
  })
  .post(
    "/update-comment",
    zValidator(
      "json",
      z.object({
        uri: z.string().optional(),
        hiveId: z.string(),
        comment: z.string(),
        parentUri: z.string(),
        parentCid: z.string(),
      }),
    ),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json({ success: false, message: "Invalid Session" }, 401);
      }
      const { hiveId, comment, parentUri, parentCid, uri } =
        await c.req.valid("json");

      const originalBuzz = uri
        ? await c
            .get("ctx")
            .db.selectFrom("buzz")
            .selectAll()
            .where("uri", "=", uri)
            .limit(1)
            .executeTakeFirst()
        : null;
      const book = await c
        .get("ctx")
        .db.selectFrom("user_book")
        .select(["cid", "uri"])
        .where("hiveId", "=", hiveId as HiveId)
        .executeTakeFirst();
      const createdAt = originalBuzz?.createdAt || new Date().toISOString();

      const bookRef = validateMain({ uri: book?.uri, cid: book?.cid });
      const parentRef = validateMain({ uri: parentUri, cid: parentCid });
      if (!bookRef.success || !parentRef.success || !book || !bookRef.value) {
        return c.json(
          {
            success: false,
            message: "Invalid Hive ID",
            description: "The book you are looking for does not exist",
          },
          404,
        );
      }

      const response = await agent.post("com.atproto.repo.applyWrites", {
        input: {
          repo: agent.did,
          writes: [
            {
              $type: originalBuzz
                ? "com.atproto.repo.applyWrites#update"
                : "com.atproto.repo.applyWrites#create",
              collection: ids.BuzzBookhiveBuzz,
              rkey: originalBuzz
                ? originalBuzz.uri.split("/").at(-1)!
                : TID.now(),
              value: {
                book: bookRef.value,
                comment,
                parent: parentRef.value,
                createdAt,
              },
            },
          ],
        },
      });

      const applyOut = response.data as {
        results?: Array<{ $type: string; uri?: string; cid?: string }>;
      } | null;
      const firstResult =
        response.ok && applyOut?.results?.[0] ? applyOut.results[0] : undefined;
      if (
        !response.ok ||
        !applyOut?.results ||
        applyOut.results.length === 0 ||
        !firstResult ||
        !(
          firstResult.$type === "com.atproto.repo.applyWrites#createResult" ||
          firstResult.$type === "com.atproto.repo.applyWrites#updateResult"
        )
      ) {
        return c.json(
          {
            success: false,
            message: "Failed to post comment",
            description: "Failed to write comment to the database",
          },
          500,
        );
      }

      await c
        .get("ctx")
        .db.insertInto("buzz")
        .values({
          uri: firstResult.uri!,
          cid: firstResult.cid!,
          userDid: agent.did,
          createdAt: createdAt,
          indexedAt: new Date().toISOString(),
          hiveId: hiveId as HiveId,
          comment,
          parentUri,
          parentCid,
          bookCid: book.cid,
          bookUri: book.uri,
        })
        .onConflict((oc) =>
          oc.column("uri").doUpdateSet((c) => ({
            indexedAt: c.ref("excluded.indexedAt"),
            cid: c.ref("excluded.cid"),
            userDid: c.ref("excluded.userDid"),
            createdAt: c.ref("excluded.createdAt"),
            hiveId: c.ref("excluded.hiveId"),
            comment: c.ref("excluded.comment"),
            parentUri: c.ref("excluded.parentUri"),
            parentCid: c.ref("excluded.parentCid"),
            bookCid: c.ref("excluded.bookCid"),
            bookUri: c.ref("excluded.bookUri"),
          })),
        )
        .execute();

      return c.json({
        success: true,
        message: "Comment posted",
        comment: { uri: firstResult.uri },
      });
    },
  )
  .post(
    "/follow",
    zValidator("json", z.object({ did: z.string() })),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.json({ success: false, message: "Invalid Session" }, 401);
      }
      const { did } = c.req.valid("json");
      if (!did || did === agent.did) {
        return c.json({ success: false, message: "Invalid DID" }, 400);
      }
      try {
        const createdAt = new Date().toISOString();
        const response = await agent.post("com.atproto.repo.applyWrites", {
          input: {
            repo: agent.did,
            writes: [
              {
                $type: "com.atproto.repo.applyWrites#create",
                collection: "app.bsky.graph.follow",
                rkey: TID.now(),
                value: { subject: did, createdAt },
              },
            ],
          },
        });
        const applyOut = response.data as {
          results?: Array<{ $type: string }>;
        } | null;
        const firstResult =
          response.ok && applyOut?.results?.[0]
            ? applyOut.results[0]
            : undefined;
        if (
          !response.ok ||
          !applyOut?.results ||
          applyOut.results.length === 0 ||
          !firstResult ||
          firstResult.$type !== "com.atproto.repo.applyWrites#createResult"
        ) {
          throw new Error("Failed to follow user");
        }
        await c
          .get("ctx")
          .db.insertInto("user_follows")
          .values({
            userDid: agent.did,
            followsDid: did,
            followedAt: createdAt,
            syncedAt: createdAt,
            lastSeenAt: createdAt,
            isActive: 1,
          })
          .onConflict((oc) =>
            oc.columns(["userDid", "followsDid"]).doUpdateSet({
              lastSeenAt: createdAt,
              isActive: 1,
            }),
          )
          .execute();
        return c.json({ success: true });
      } catch (e: unknown) {
        return c.json(
          {
            success: false,
            message: (e as Error)?.message || "Follow failed",
          },
          400,
        );
      }
    },
  )
  .post(
    "/follow-form",
    zValidator("form", z.object({ did: z.string() })),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        return c.redirect("/", 302);
      }
      const { did } = c.req.valid("form");
      let targetHandle = did;
      try {
        targetHandle = await c.get("ctx").resolver.resolveDidToHandle(did);
      } catch {}
      if (!did || did === agent.did) {
        return c.redirect(`/profile/${targetHandle}`, 302);
      }
      try {
        const createdAt = new Date().toISOString();
        await agent.post("com.atproto.repo.applyWrites", {
          input: {
            repo: agent.did,
            writes: [
              {
                $type: "com.atproto.repo.applyWrites#create",
                collection: "app.bsky.graph.follow",
                rkey: TID.now(),
                value: { subject: did, createdAt },
              },
            ],
          },
        });
        const now = new Date().toISOString();
        await c
          .get("ctx")
          .db.insertInto("user_follows")
          .values({
            userDid: agent.did,
            followsDid: did,
            followedAt: createdAt,
            syncedAt: now,
            lastSeenAt: now,
            isActive: 1,
          })
          .onConflict((oc) =>
            oc.columns(["userDid", "followsDid"]).doUpdateSet({
              lastSeenAt: now,
              isActive: 1,
            }),
          )
          .execute();
      } catch {}
      return c.redirect(`/profile/${targetHandle}`, 302);
    },
  );

export default app;
