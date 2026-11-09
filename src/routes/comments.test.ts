import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { AppEnv } from "../context";
import type { SessionClient } from "../auth/client";
import type { HiveId } from "../types";
import { createTestDb, testContext } from "../test/db";
import comments from "./comments";

const did = "did:plc:commentowner";
const uri = `at://${did}/buzz.bookhive.buzz/test`;

describe("comment deletion acknowledgement", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    await testDb.db
      .insertInto("buzz")
      .values({
        uri,
        cid: "original",
        userDid: did,
        comment: "Keep until confirmed",
        bookUri: `at://${did}/buzz.bookhive.book/book`,
        bookCid: "book-cid",
        hiveId: "bk_comment" as HiveId,
        parentUri: `at://${did}/buzz.bookhive.book/book`,
        parentCid: "book-cid",
        createdAt: "2026-11-08T00:00:00.000Z",
        indexedAt: "2026-11-08T00:00:00.000Z",
      })
      .execute();
  });
  afterEach(async () => {
    await testDb.close();
  });

  function app(post: SessionClient["post"], viewer: string | null = did) {
    const app = new Hono<AppEnv>();
    app.use("*", jsxRenderer());
    app.use("*", async (c, next) => {
      c.set(
        "ctx",
        testContext({
          db: testDb.db,
          getSessionAgent: async () =>
            viewer ? ({ did: viewer, post } as unknown as SessionClient) : null,
        }),
      );
      await next();
    });
    app.route("/comments", comments);
    return app;
  }

  it("keeps the mirror when the PDS rejects deletion", async () => {
    const post = mock(async () => ({ ok: false, data: { error: "Rejected" } }));
    const res = await app(post as unknown as SessionClient["post"]).request("/comments/test", {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, commentId: "test" });
    expect(await testDb.db.selectFrom("buzz").selectAll().execute()).toHaveLength(1);
  });

  it("removes the mirror only after confirmed deletion", async () => {
    const post = mock(async () => ({ ok: true, data: {} }));
    const res = await app(post as unknown as SessionClient["post"]).request("/comments/test", {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(await testDb.db.selectFrom("buzz").selectAll().execute()).toHaveLength(0);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("renders a failure for no-JS deletion without removing the mirror", async () => {
    const post = mock(async () => ({ ok: false, data: { error: "Rejected" } }));
    const res = await app(post as unknown as SessionClient["post"]).request("/comments/test", {
      method: "DELETE",
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Failed to delete comment");
    expect(await testDb.db.selectFrom("buzz").selectAll().execute()).toHaveLength(1);
  });

  it("does not delete another viewer's mirror", async () => {
    const post = mock(async () => ({ ok: true, data: {} }));
    const res = await app(post as unknown as SessionClient["post"], "did:plc:other").request(
      "/comments/test",
      {
        method: "DELETE",
        headers: { accept: "application/json" },
      },
    );
    expect(await res.json()).toMatchObject({ success: false });
    expect(post).not.toHaveBeenCalled();
    expect(await testDb.db.selectFrom("buzz").selectAll().execute()).toHaveLength(1);
  });

  for (const outcome of ["success", "rejected", "thrown"] as const) {
    it.each([
      ["application/json", true],
      ["application/json; charset=utf-8", true],
      ["text/plain, application/json; q=0.8", true],
      ["text/html;q=0.2, application/json;q=0.9", true],
      ["application/*;q=0.8, text/html;q=0.2", true],
      ["*/*;q=0.1, application/json;q=0.9", true],
      ["APPLICATION/JSON", true],
      ["application/json;q=0", false],
      ["application/json;q=0, */*;q=1", false],
      ["application/json;q=0.2, text/html;q=0.9", false],
      ["application/json;q=0.2, application/*;q=0.9, text/html;q=0.5", false],
      ["text/html, application/json", false],
      ["*/*", false],
      ["text/html", false],
      [undefined, false],
    ] as const)(`${outcome}: negotiates Accept %s consistently`, async (accept, json) => {
      const post = mock(async () => {
        if (outcome === "thrown") throw new Error("PDS transport failed");
        return { ok: outcome === "success", data: {} };
      });
      const res = await app(post as unknown as SessionClient["post"]).request("/comments/test", {
        method: "DELETE",
        headers: accept ? { accept } : {},
      });
      const success = outcome === "success";
      expect(res.status).toBe(success ? (json ? 200 : 302) : 500);
      if (json) {
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(await res.json()).toMatchObject({ success, commentId: "test" });
      } else if (success) {
        expect(res.headers.get("location")).toBe("/books/bk_comment");
      } else {
        expect(res.headers.get("content-type")).toContain("text/html");
        const html = await res.text();
        expect(html).toContain("Failed to delete comment");
        expect(html).not.toContain("PDS transport failed");
      }
      expect(await testDb.db.selectFrom("buzz").selectAll().execute()).toHaveLength(
        success ? 0 : 1,
      );
      expect(post).toHaveBeenCalledTimes(1);
    });
  }

  it.each(["application/json", "text/html"])(
    "preserves authentication for Accept %s",
    async (accept) => {
      const post = mock(async () => ({ ok: true, data: {} }));
      const res = await app(post as unknown as SessionClient["post"], null).request(
        "/comments/test",
        {
          method: "DELETE",
          headers: { accept },
        },
      );
      expect(res.status).toBe(401);
      expect(await res.text()).toContain("Login to delete a comment");
      expect(post).not.toHaveBeenCalled();
      expect(await testDb.db.selectFrom("buzz").selectAll().execute()).toHaveLength(1);
    },
  );
});
