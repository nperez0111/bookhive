/**
 * Comment POST (form) and DELETE. Mount at /comments.
 * Parent must run methodOverride for /comments/:commentId before mounting this router.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ids } from "../bsky/lexicon";
import { Error as ErrorPage } from "../pages/error";
import type { HiveId } from "../types";
import { upsertBuzz } from "../services/buzzWrite";

const app = new Hono<AppEnv>()
  .post(
    "/",
    zValidator(
      "form",
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
        c.status(401);
        return c.render(
          <ErrorPage
            message="Invalid Session"
            description="Login to post a comment"
            statusCode={401}
          />,
          { title: "Unauthorized" },
        );
      }
      const { hiveId, comment, parentUri, parentCid, uri } = c.req.valid("form");

      const result = await upsertBuzz({
        ctx: c.get("ctx"),
        agent,
        input: { hiveId: hiveId as HiveId, comment, parentUri, parentCid, uri },
      });

      if (!result.ok) {
        if (result.reason === "book_not_found") {
          c.status(404);
          return c.render(
            <ErrorPage message="Invalid Hive ID" description={result.message} statusCode={404} />,
            { title: "Book Not Found" },
          );
        }
        c.set("requestError", new Error(result.message));
        c.status(500);
        return c.render(
          <ErrorPage
            message="Failed to post comment"
            description={result.message}
            statusCode={500}
          />,
          { title: "Error" },
        );
      }

      return c.redirect("/books/" + hiveId);
    },
  )
  .delete("/:commentId", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      c.status(401);
      return c.render(
        <ErrorPage
          message="Invalid Session"
          description="Login to delete a comment"
          statusCode={401}
        />,
        { title: "Unauthorized" },
      );
    }
    const commentId = c.req.param("commentId") as string;
    const commentUri = `at://${agent.did}/${ids.BuzzBookhiveBuzz}/${commentId}`;

    const comment = await c
      .get("ctx")
      .db.selectFrom("buzz")
      .selectAll()
      .where("userDid", "=", agent.did)
      .where("uri", "=", commentUri)
      .execute();

    if (comment.length === 0) {
      return c.json({ success: false, commentId, book: null });
    }

    await agent.post("com.atproto.repo.deleteRecord", {
      input: {
        repo: agent.did,
        collection: ids.BuzzBookhiveBuzz,
        rkey: commentId,
      },
    });
    await c
      .get("ctx")
      .db.deleteFrom("buzz")
      .where("userDid", "=", agent.did)
      .where("uri", "=", commentUri)
      .execute();

    c.get("ctx").addWideEventContext({
      comment_delete: true,
      commentId,
      hiveId: comment[0]!.hiveId,
      userDid: agent.did,
    });
    if (c.req.header()["accept"] === "application/json") {
      return c.json({ success: true, commentId, comment: comment[0] });
    }
    // A buzz can carry a null hiveId; redirecting blindly produced /books/null.
    const deletedHiveId = comment[0]!.hiveId;
    return c.redirect(deletedHiveId ? "/books/" + deletedHiveId : "/home");
  });

export default app;
