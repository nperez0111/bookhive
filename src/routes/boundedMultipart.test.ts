import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  readBoundedMultipart,
  MultipartTooLargeError,
  MultipartTimeoutError,
} from "./boundedMultipart";

describe("byte-counted multipart parsing", () => {
  it("ends a stalled body at the absolute deadline and cancels its reader", async () => {
    let cancelled = false;
    let active = false;
    const app = new Hono().post("/", async (c) => {
      active = true;
      try {
        await readBoundedMultipart(c.req, 1024, 20);
        return c.text("parsed");
      } catch (error) {
        expect(error).toBeInstanceOf(MultipartTimeoutError);
        return c.text("timed out", 408);
      } finally {
        active = false;
      }
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("--test\r\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await app.request(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body,
      }),
    );
    expect(response.status).toBe(408);
    expect(cancelled).toBe(true);
    expect(active).toBe(false);
  });
  function app(limit: number) {
    return new Hono().post(
      "/",
      async (c, next) => {
        try {
          await readBoundedMultipart(c.req, limit);
        } catch (error) {
          return c.text(
            error instanceof MultipartTooLargeError ? "too large" : "bad form",
            error instanceof MultipartTooLargeError ? 413 : 400,
          );
        }
        await next();
        return;
      },
      zValidator("form", z.object({ export: z.instanceof(File) })),
      (c) => c.json({ size: c.req.valid("form").export.size }),
    );
  }

  it("populates Hono's form cache for the usual validator", async () => {
    const body = new FormData();
    body.append("export", new File(["hello"], "books.csv"));
    const res = await app(1024).request("/", { method: "POST", body });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ size: 5 });
  });

  for (const length of [undefined, "1"]) {
    it(`counts actual bytes with ${length ? "a dishonest" : "no"} Content-Length`, async () => {
      let reads = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads++;
            controller.enqueue(new Uint8Array(64));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const headers: Record<string, string> = {
        "content-type": "multipart/form-data; boundary=test",
      };
      if (length) headers["content-length"] = length;
      const res = await app(100).request(
        new Request("http://localhost/", { method: "POST", headers, body }),
      );
      expect(res.status).toBe(413);
      expect(reads).toBe(2);
      expect(cancelled).toBe(true);
    });
  }

  it("rejects a large declared body without pulling it", async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          reads++;
        },
      },
      { highWaterMark: 0 },
    );
    const res = await app(100).request(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-length": "101" },
        body,
      }),
    );
    expect(res.status).toBe(413);
    expect(reads).toBe(0);
  });
});
