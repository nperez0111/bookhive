/**
 * Comment POST (form) and DELETE. Mount at /comments.
 * Parent must run methodOverride for /comments/:commentId before mounting this router.
 */
import * as TID from "@atcute/tid";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ids, validateMain } from "../bsky/lexicon";
import { Error as ErrorPage } from "../pages/error";
import { Layout } from "../pages/layout";
import type { HiveId } from "../types";

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
        return c.html(
          <Layout>
            <ErrorPage
              message="Invalid Session"
              description="Login to post a comment"
              statusCode={401}
            />
          </Layout>,
          401,
        );
      }
      const { hiveId, comment, parentUri, parentCid, uri } =
        await c.req.valid("form");

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
        return c.html(
          <Layout>
            <ErrorPage
              message="Invalid Hive ID"
              description="The book you are looking for does not exist"
              statusCode={404}
            />
          </Layout>,
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

      type ApplyWritesOut = {
        results?: Array<{ $type: string; uri?: string; cid?: string }>;
      };
      const out = response.data as ApplyWritesOut | null;
      const firstResult =
        response.ok && out?.results?.[0] ? out.results[0] : undefined;
      if (
        !response.ok ||
        !out?.results ||
        out.results.length === 0 ||
        !firstResult ||
        !(
          firstResult.$type === "com.atproto.repo.applyWrites#createResult" ||
          firstResult.$type === "com.atproto.repo.applyWrites#updateResult"
        )
      ) {
        c.set(
          "requestError",
          new Error("Failed to write comment to the database"),
        );
        return c.html(
          <Layout>
            <ErrorPage
              message="Failed to post comment"
              description="Failed to write comment to the database"
              statusCode={500}
            />
          </Layout>,
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

      return c.redirect("/books/" + hiveId);
    },
  )
  .delete("/:commentId", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) {
      return c.html(
        <Layout>
          <ErrorPage
            message="Invalid Session"
            description="Login to delete a comment"
            statusCode={401}
          />
        </Layout>,
        401,
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

    if (c.req.header()["accept"] === "application/json") {
      return c.json({ success: true, commentId, comment: comment[0] });
    }
    return c.redirect("/books/" + comment[0].hiveId);
  });

export default app;
