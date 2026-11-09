/**
 * Comment POST (form) and DELETE. Mount at /comments.
 * Parent must run methodOverride for /comments/:commentId before mounting this router.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { accepts } from "hono/accepts";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ids } from "../bsky/lexicon";
import { Error as ErrorPage } from "../pages/error";
import type { HiveId } from "../types";
import { upsertBuzz } from "../services/buzzWrite";
import { renderError } from "./errorPage";

function wantsJson(c: Context<AppEnv>): boolean {
  return (
    accepts(c, {
      header: "Accept",
      supports: ["text/html", "application/json"],
      default: "text/html",
      // The installed helper's default matcher ignores wildcards and accepts q=0.
      // Specific exclusions must beat broader ranges; HTML wins an otherwise equal tie.
      match: (ranges, { supports, default: fallback }) => {
        const choices = supports.map((type) => {
          const best = ranges
            .map((range) => ({
              q: range.q,
              specificity:
                range.type.toLowerCase() === type
                  ? 2
                  : range.type.toLowerCase() === type.split("/")[0] + "/*"
                    ? 1
                    : range.type === "*/*"
                      ? 0
                      : -1,
            }))
            .filter((range) => range.specificity >= 0)
            .sort((a, b) => b.specificity - a.specificity || b.q - a.q)[0];
          return { type, q: best?.q ?? 0, specificity: best?.specificity ?? -1 };
        });
        return (
          choices
            .filter((choice) => choice.q > 0)
            .sort((a, b) => b.q - a.q || b.specificity - a.specificity)[0]?.type ?? fallback
        );
      },
    }) === "application/json"
  );
}

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
    const json = wantsJson(c);
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

    const deletionFailed = (error: unknown) => {
      c.set(
        "requestError",
        error instanceof Error ? error : new Error("PDS comment deletion failed", { cause: error }),
      );
      if (json) {
        return c.json({ success: false, commentId, message: "Failed to delete comment" }, 500);
      }
      return renderError(c, {
        status: 500,
        message: "Failed to delete comment",
        description: "The comment could not be deleted. Please try again.",
      });
    };
    try {
      const deleted = await agent.post("com.atproto.repo.deleteRecord", {
        input: {
          repo: agent.did,
          collection: ids.BuzzBookhiveBuzz,
          rkey: commentId,
        },
      });
      if (!deleted.ok) {
        return deletionFailed(new Error("PDS rejected comment deletion"));
      }
    } catch (error) {
      return deletionFailed(error);
    }
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
    if (json) {
      return c.json({ success: true, commentId, comment: comment[0] });
    }
    // A buzz can carry a null hiveId; redirecting blindly produced /books/null.
    const deletedHiveId = comment[0]!.hiveId;
    return c.redirect(deletedHiveId ? "/books/" + deletedHiveId : "/home");
  });

export default app;
