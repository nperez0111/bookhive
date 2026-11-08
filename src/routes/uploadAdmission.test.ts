import { afterAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import type { SessionClient } from "../auth/client";
import type { StoredSession } from "@atcute/oauth-node-client";
import { createTestDb, testContext } from "../test/db";
import libraryRouter, { getMultipartUploadAdmissionState } from "./library";
import importRouter, { getImportAdmissionState } from "./import";

describe("multipart admission before materialisation", () => {
  const database = createTestDb();
  afterAll(async () => {
    await (await database).close();
  });
  async function app(signedIn: boolean) {
    const { db } = await database;
    const ctx = testContext({
      db,
      getSessionAgent: async () =>
        signedIn ? ({ did: "did:plc:upload-test" } as SessionClient) : null,
    });
    if (signedIn) await ctx.kv.set("auth_session:did:plc:upload-test", {} as StoredSession);
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("ctx", ctx);
      await next();
    });
    app.route("/library", libraryRouter);
    app.route("/import", importRouter);
    app.get("/import", (c) => c.text("import page"));
    return app;
  }

  it("does not intercept the GET import page or unknown routes", async () => {
    const signedOut = await app(false);
    expect((await signedOut.request("/import")).status).toBe(200);
    expect((await signedOut.request("/import/unknown", { method: "POST" })).status).toBe(404);
  });

  for (const [path, snapshot] of [
    ["/library/upload", getMultipartUploadAdmissionState],
    ["/import/goodreads", getImportAdmissionState],
  ] as const) {
    it(`${path} authenticates before reading any body bytes`, async () => {
      let reads = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            reads++;
          },
        },
        { highWaterMark: 0 },
      );
      const res = await (
        await app(false)
      ).request(
        new Request(`http://localhost${path}`, {
          method: "POST",
          body,
          headers: { accept: "application/json" },
        }),
      );
      expect(res.status).toBe(401);
      expect(reads).toBe(0);
      expect(snapshot()).toEqual({ active: 0, pending: 0 });
    });

    it(`${path} preserves human-readable size errors and releases admission`, async () => {
      const signedIn = await app(true);
      let reads = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            reads++;
          },
        },
        { highWaterMark: 0 },
      );
      const res = await signedIn.request(
        new Request(`http://localhost${path}`, {
          method: "POST",
          body,
          headers: { "content-length": String(200 * 1024 * 1024), accept: "application/json" },
        }),
      );
      expect(res.status).toBe(413);
      const payload = await res.json();
      if (path === "/library/upload")
        expect(payload).toEqual({ error: "File exceeds 100 MB limit", code: "TooLarge" });
      else expect(payload).toEqual({ success: false, error: "Upload too large (max 50 MB)" });
      expect(reads).toBe(0);
      expect(snapshot()).toEqual({ active: 0, pending: 0 });
    });

    it(`${path} rejects a second body unread and releases after parse failure`, async () => {
      const signedIn = await app(true);
      let close!: () => void;
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      const body = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            close = () => controller.close();
          },
          pull() {
            started();
          },
        },
        { highWaterMark: 0 },
      );
      const first = signedIn.request(
        new Request(`http://localhost${path}`, {
          method: "POST",
          body,
          headers: {
            "content-type": "multipart/form-data; boundary=test",
            accept: "application/json",
          },
        }),
      );
      await reading;
      expect(snapshot()).toEqual({ active: 1, pending: 0 });
      let reads = 0;
      const second = await signedIn.request(
        new Request(`http://localhost${path}`, {
          method: "POST",
          body: new ReadableStream(
            {
              pull() {
                reads++;
              },
            },
            { highWaterMark: 0 },
          ),
          headers: { accept: "application/json" },
        }),
      );
      expect(second.status).toBe(503);
      expect(reads).toBe(0);
      close();
      expect((await first).status).toBe(400);
      expect(snapshot()).toEqual({ active: 0, pending: 0 });
    });
  }
});
