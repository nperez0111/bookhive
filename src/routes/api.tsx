/**
 * JSON/form API: update-book, update-comment, follow, follow-form.
 * Mount at /api so paths are /api/update-book, etc.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { startTime, endTime } from "hono/timing";
import { z } from "zod";

import type { AppEnv } from "../context";
import type { BookProgress, HiveId } from "../types";
import { bookProgressProblem } from "../core/bookProgress";
import { upsertBuzz } from "../services/buzzWrite";
import { followUser, unfollowUser } from "../services/followGraph";
import { BookWriteError, getUserBook, updateBookRecord, withBookLock } from "../services/getBook";
import { errorMessage } from "../lib/errors";
import { toUserBookView } from "../core/userBookView";
import { dateInputToISO } from "../lib/dateInput";
import { HIVE_ID_PATTERN } from "../core/hiveId";
import { jsonUnauthorized } from "./authResponse";

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

const userBookQuerySchema = z.object({
  hiveId: z.string().regex(HIVE_ID_PATTERN),
});

const app = new Hono<AppEnv>()
  // Cookie DID only — no OAuth restore, since nothing here touches the PDS.
  .get("/user-book", zValidator("query", userBookQuerySchema), async (c) => {
    const did = await c.get("ctx").getSessionDid();
    if (!did) {
      return jsonUnauthorized(c);
    }
    const { hiveId } = c.req.valid("query");
    const userBook = await getUserBook({
      ctx: c.get("ctx"),
      agent: { did },
      hiveId: hiveId as HiveId,
    });
    return c.json({ success: true, userBook: userBook ? toUserBookView(userBook) : null });
  })
  .post("/update-book", zValidator("json", updateBookSchema), async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return jsonUnauthorized(c);
    }
    const payload = c.req.valid("json");
    const { hiveId, bookProgress, ...updates } = payload;

    let normalizedProgress: BookProgress | undefined | null = bookProgress as
      | BookProgress
      | null
      | undefined;
    if (bookProgress) {
      normalizedProgress = { ...bookProgress, updatedAt: new Date().toISOString() } as BookProgress;
      const problem = bookProgressProblem(normalizedProgress);
      if (problem) {
        return c.json({ success: false, message: problem }, 400);
      }
    }
    if (normalizedProgress !== undefined) {
      // No status asserted here — `nextReadingState` derives Reading/Finished from
      // progress plus the existing record, so asserting it here could downgrade finished books.
      (updates as Record<string, unknown>)["bookProgress"] = normalizedProgress;
    }
    if (!hiveId) {
      return c.json({ success: false, message: "Invalid ID" }, 400);
    }
    try {
      const lock = await withBookLock(c.get("ctx").kv, agent.did, hiveId as HiveId, async () => {
        startTime(c, "pds_update_book");
        const { userBook } = await updateBookRecord({
          ctx: c.get("ctx"),
          agent,
          hiveId: hiveId as HiveId,
          updates,
        });
        endTime(c, "pds_update_book");
        return userBook;
      });
      if (lock.locked) {
        c.get("ctx").addWideEventContext({ api_update_book: "locked", hiveId });
        return c.json({ success: false, message: "Another book write is in flight" }, 429);
      }
      c.get("ctx").addWideEventContext({
        api: "update_book",
        hiveId,
        userDid: agent.did,
      });
      return c.json({
        success: true,
        message: "Book updated",
        userBook: toUserBookView(lock.value),
      });
    } catch (e) {
      // `BookWriteError` is a rejected input, not a defect — kept off the error-rate signal.
      const rejected = e instanceof BookWriteError;
      if (!rejected) c.set("requestError", e);
      c.get("ctx").addWideEventContext({
        api_update_book: rejected ? "rejected" : "failed",
        hiveId,
        userDid: agent.did,
        error: errorMessage(e),
      });
      return c.json({ success: false, message: errorMessage(e) }, 400);
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
        return jsonUnauthorized(c);
      }
      const { hiveId, comment, parentUri, parentCid, uri } = c.req.valid("json");

      startTime(c, "pds_write_comment");
      const result = await upsertBuzz({
        ctx: c.get("ctx"),
        agent,
        input: { hiveId: hiveId as HiveId, comment, parentUri, parentCid, uri },
      });
      endTime(c, "pds_write_comment");

      if (!result.ok) {
        if (result.reason === "book_not_found") {
          return c.json(
            { success: false, message: "Invalid Hive ID", description: result.message },
            404,
          );
        }
        c.set("requestError", new Error(result.message));
        return c.json(
          { success: false, message: "Failed to post comment", description: result.message },
          500,
        );
      }

      return c.json({
        success: true,
        message: "Comment posted",
        comment: { uri: result.buzz.uri },
      });
    },
  )
  .post("/follow", zValidator("json", z.object({ did: z.string() })), async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return jsonUnauthorized(c);
    }
    const { did } = c.req.valid("json");
    if (!did || did === agent.did) {
      return c.json({ success: false, message: "Invalid DID" }, 400);
    }
    startTime(c, "pds_follow");
    const result = await followUser({ db: c.get("ctx").db, agent, targetDid: did });
    endTime(c, "pds_follow");
    c.get("ctx").addWideEventContext({
      follow_write: result.ok ? "followed" : "failed",
      userDid: agent.did,
      targetDid: did,
      ...(result.ok ? {} : { error: result.message }),
    });
    return result.ok
      ? c.json({ success: true })
      : c.json({ success: false, message: result.message }, 400);
  })
  .post("/follow-form", zValidator("form", z.object({ did: z.string() })), async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.redirect("/login", 302);
    }
    const { did } = c.req.valid("form");
    let targetHandle = did;
    try {
      targetHandle = await c.get("ctx").resolver.resolveDidToHandle(did);
    } catch {}
    if (did && did !== agent.did) {
      const result = await followUser({ db: c.get("ctx").db, agent, targetDid: did });
      c.get("ctx").addWideEventContext({
        follow_write: result.ok ? "followed" : "failed",
        follow_surface: "form",
        userDid: agent.did,
        targetDid: did,
        ...(result.ok ? {} : { error: result.message }),
      });
    }
    return c.redirect(`/profile/${targetHandle}`, 302);
  })
  .post("/unfollow", zValidator("json", z.object({ did: z.string() })), async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return jsonUnauthorized(c);
    }
    const { did } = c.req.valid("json");
    if (!did || did === agent.did) {
      return c.json({ success: false, message: "Invalid DID" }, 400);
    }
    startTime(c, "pds_unfollow");
    const result = await unfollowUser({ db: c.get("ctx").db, agent, targetDid: did });
    endTime(c, "pds_unfollow");
    c.get("ctx").addWideEventContext({
      follow_write: result.ok ? "unfollowed" : "failed",
      userDid: agent.did,
      targetDid: did,
      ...(result.ok ? {} : { error: result.message }),
    });
    return result.ok
      ? c.json({ success: true })
      : c.json({ success: false, message: result.message }, 400);
  })
  .post("/unfollow-form", zValidator("form", z.object({ did: z.string() })), async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.redirect("/login", 302);
    }
    const { did } = c.req.valid("form");
    let targetHandle = did;
    try {
      targetHandle = await c.get("ctx").resolver.resolveDidToHandle(did);
    } catch {}
    if (did && did !== agent.did) {
      const result = await unfollowUser({ db: c.get("ctx").db, agent, targetDid: did });
      c.get("ctx").addWideEventContext({
        follow_write: result.ok ? "unfollowed" : "failed",
        follow_surface: "form",
        userDid: agent.did,
        targetDid: did,
        ...(result.ok ? {} : { error: result.message }),
      });
    }
    return c.redirect(`/profile/${targetHandle}`, 302);
  });

export default app;
