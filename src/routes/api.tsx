/**
 * JSON/form API: update-book, update-comment, follow, follow-form.
 * Mount at /api so paths are /api/update-book, etc.
 */
import * as TID from "@atcute/tid";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { startTime, endTime } from "hono/timing";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ids, validateMain } from "../bsky/lexicon";
import { BOOK_STATUS } from "../constants";
import type { BookProgress, HiveId } from "../types";
import { updateBookRecord } from "../utils/getBook";

/**
 * Convert a date-input value to a full ISO datetime. YYYY-MM-DD inputs are
 * combined with the current UTC time-of-day so the timestamp captures when
 * the user logged the date (matching createdAt behavior).
 */
function dateInputToISO(val: string): string {
  if (!val || val === "") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [year, month, day] = val.split("-").map(Number) as [number, number, number];
    const now = new Date();
    return new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
        now.getUTCMilliseconds(),
      ),
    ).toISOString();
  }
  return val;
}

const updateBookSchema = z.object({
  hiveId: z.string(),
  status: z.optional(z.string()),
  owned: z.optional(z.boolean()),
  review: z.optional(z.string()),
  stars: z.optional(z.number()),
  startedAt: z.optional(
    z
      .string()
      .transform(dateInputToISO)
      .pipe(z.string().datetime().or(z.literal(""))),
  ),
  finishedAt: z.optional(
    z
      .string()
      .transform(dateInputToISO)
      .pipe(z.string().datetime().or(z.literal(""))),
  ),
  bookProgress: z
    .union([
      z
        .object({
          percent: z.coerce.number().int().min(0).max(100).optional(),
          totalPages: z
            .preprocess((val) => (val === "" ? undefined : val), z.coerce.number().int().min(1))
            .optional(),
          currentPage: z
            .preprocess((val) => (val === "" ? undefined : val), z.coerce.number().int().min(1))
            .optional(),
          totalChapters: z
            .preprocess((val) => (val === "" ? undefined : val), z.coerce.number().int().min(1))
            .optional(),
          currentChapter: z
            .preprocess((val) => (val === "" ? undefined : val), z.coerce.number().int().min(1))
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
      (updates as Record<string, unknown>)["bookProgress"] = normalizedProgress;
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
      startTime(c, "pds_update_book");
      await updateBookRecord({
        ctx: c.get("ctx"),
        agent,
        hiveId: hiveId as HiveId,
        updates,
      });
      endTime(c, "pds_update_book");
      c.get("ctx").addWideEventContext({
        api: "update_book",
        hiveId,
        userDid: agent.did,
      });
      return c.json({ success: true, message: "Book updated" });
    } catch (e) {
      c.get("ctx").addWideEventContext({
        api_update_book: "failed",
        hiveId,
        userDid: agent.did,
        error: (e as Error).message,
      });
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
      const { hiveId, comment, parentUri, parentCid, uri } = c.req.valid("json");

      startTime(c, "db_fetch_comment_refs");
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
      endTime(c, "db_fetch_comment_refs");
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

      startTime(c, "pds_write_comment");
      const response = await agent.post("com.atproto.repo.applyWrites", {
        input: {
          repo: agent.did,
          writes: [
            {
              $type: originalBuzz
                ? "com.atproto.repo.applyWrites#update"
                : "com.atproto.repo.applyWrites#create",
              collection: ids.BuzzBookhiveBuzz,
              rkey: originalBuzz ? originalBuzz.uri.split("/").at(-1)! : TID.now(),
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
      endTime(c, "pds_write_comment");

      const applyOut = response.data as {
        results?: Array<{ $type: string; uri?: string; cid?: string }>;
      } | null;
      const firstResult = response.ok && applyOut?.results?.[0] ? applyOut.results[0] : undefined;
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
        c.set("requestError", new Error("Failed to write comment to the database"));
        c.get("ctx").addWideEventContext({
          api_update_comment: "failed",
          hiveId,
          userDid: agent.did,
          error: "applyWrites result invalid",
        });
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

      c.get("ctx").addWideEventContext({
        api: "update_comment",
        hiveId,
        userDid: agent.did,
        comment_uri: firstResult.uri,
      });
      return c.json({
        success: true,
        message: "Comment posted",
        comment: { uri: firstResult.uri },
      });
    },
  )
  .post("/follow", zValidator("json", z.object({ did: z.string() })), async (c) => {
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
      startTime(c, "pds_follow");
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
      endTime(c, "pds_follow");
      const applyOut = response.data as {
        results?: Array<{ $type: string }>;
      } | null;
      const firstResult = response.ok && applyOut?.results?.[0] ? applyOut.results[0] : undefined;
      if (
        !response.ok ||
        !applyOut?.results ||
        applyOut.results.length === 0 ||
        !firstResult ||
        firstResult.$type !== "com.atproto.repo.applyWrites#createResult"
      ) {
        throw new Error("Failed to follow user");
      }
      startTime(c, "db_follow");
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
      endTime(c, "db_follow");
      c.get("ctx").addWideEventContext({
        api: "follow",
        userDid: agent.did,
        targetDid: did,
      });
      return c.json({ success: true });
    } catch (e: unknown) {
      c.get("ctx").addWideEventContext({
        api_follow: "failed",
        userDid: agent.did,
        targetDid: did,
        error: (e as Error)?.message ?? "Follow failed",
      });
      return c.json(
        {
          success: false,
          message: (e as Error)?.message || "Follow failed",
        },
        400,
      );
    }
  })
  .post("/follow-form", zValidator("form", z.object({ did: z.string() })), async (c) => {
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
      c.get("ctx").addWideEventContext({
        api: "follow_form",
        userDid: agent.did,
        targetDid: did,
      });
    } catch (e: unknown) {
      c.get("ctx").addWideEventContext({
        api_follow_form: "failed",
        userDid: agent.did,
        targetDid: did,
        error: (e as Error)?.message ?? "Follow failed",
      });
    }
    return c.redirect(`/profile/${targetHandle}`, 302);
  })
  .post("/unfollow", zValidator("json", z.object({ did: z.string() })), async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.json({ success: false, message: "Invalid Session" }, 401);
    }
    const { did } = c.req.valid("json");
    if (!did || did === agent.did) {
      return c.json({ success: false, message: "Invalid DID" }, 400);
    }
    try {
      startTime(c, "pds_list_follows");
      const listRes = await agent.get("com.atproto.repo.listRecords", {
        params: {
          repo: agent.did,
          collection: "app.bsky.graph.follow",
          limit: 300,
        },
      });
      endTime(c, "pds_list_follows");
      if (!listRes.ok) throw new Error("Failed to list follows");
      const data = listRes.data as {
        records: Array<{ uri: string; value: { subject: string } }>;
      };
      const followRecord = data.records.find((r) => r.value?.subject === did);
      if (!followRecord) {
        await c
          .get("ctx")
          .db.updateTable("user_follows")
          .set({ isActive: 0 })
          .where("userDid", "=", agent.did)
          .where("followsDid", "=", did)
          .execute();
        c.get("ctx").addWideEventContext({
          api: "unfollow",
          userDid: agent.did,
          targetDid: did,
        });
        return c.json({ success: true });
      }
      startTime(c, "pds_unfollow");
      const applyResult = await agent.post("com.atproto.repo.applyWrites", {
        input: {
          repo: agent.did,
          writes: [
            {
              $type: "com.atproto.repo.applyWrites#delete",
              collection: "app.bsky.graph.follow",
              rkey: followRecord.uri.split("/").at(-1)!,
            },
          ],
        },
      });
      endTime(c, "pds_unfollow");
      if (!applyResult.ok) {
        c.get("ctx").addWideEventContext({
          applyWrites_unfollow_error: "remote delete failed",
          followUri: followRecord.uri,
          userDid: agent.did,
        });
        throw new Error("Failed to delete follow record on remote");
      }
      await c
        .get("ctx")
        .db.updateTable("user_follows")
        .set({ isActive: 0 })
        .where("userDid", "=", agent.did)
        .where("followsDid", "=", did)
        .execute();
      c.get("ctx").addWideEventContext({
        api: "unfollow",
        userDid: agent.did,
        targetDid: did,
      });
      return c.json({ success: true });
    } catch (e: unknown) {
      c.get("ctx").addWideEventContext({
        api_unfollow: "failed",
        userDid: agent.did,
        targetDid: did,
        error: (e as Error)?.message ?? "Unfollow failed",
      });
      return c.json(
        {
          success: false,
          message: (e as Error)?.message || "Unfollow failed",
        },
        400,
      );
    }
  })
  .post("/unfollow-form", zValidator("form", z.object({ did: z.string() })), async (c) => {
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
      const listRes = await agent.get("com.atproto.repo.listRecords", {
        params: {
          repo: agent.did,
          collection: "app.bsky.graph.follow",
          limit: 300,
        },
      });
      let remoteDeleteSucceeded = true;
      if (listRes.ok) {
        const data = listRes.data as {
          records: Array<{ uri: string; value: { subject: string } }>;
        };
        const followRecord = data.records.find((r) => r.value?.subject === did);
        if (followRecord) {
          const applyResult = await agent.post("com.atproto.repo.applyWrites", {
            input: {
              repo: agent.did,
              writes: [
                {
                  $type: "com.atproto.repo.applyWrites#delete",
                  collection: "app.bsky.graph.follow",
                  rkey: followRecord.uri.split("/").at(-1)!,
                },
              ],
            },
          });
          if (!applyResult.ok) {
            remoteDeleteSucceeded = false;
            c.get("ctx").addWideEventContext({
              applyWrites_unfollow_form_error: "remote delete failed",
              followUri: followRecord.uri,
              userDid: agent.did,
            });
          }
        }
      }
      if (remoteDeleteSucceeded) {
        await c
          .get("ctx")
          .db.updateTable("user_follows")
          .set({ isActive: 0 })
          .where("userDid", "=", agent.did)
          .where("followsDid", "=", did)
          .execute();
      }
      c.get("ctx").addWideEventContext({
        api: "unfollow_form",
        userDid: agent.did,
        targetDid: did,
      });
    } catch (e: unknown) {
      c.get("ctx").addWideEventContext({
        api_unfollow_form: "failed",
        userDid: agent.did,
        targetDid: did,
        error: (e as Error)?.message ?? "Unfollow failed",
      });
    }
    return c.redirect(`/profile/${targetHandle}`, 302);
  });

export default app;
