/**
 * Import routes: Goodreads and StoryGraph CSV upload.
 * Spawns a Bun Worker for the heavy processing and relays SSE events.
 * Mount at /import so paths are /import/goodreads, /import/storygraph.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { AppEnv } from "../context";
import type { ImportRequest, ImportWorkerMessage } from "../workers/import/types";
import { env } from "../env";
import { activeOperations, importBatchDuration, LABEL } from "../metrics";

const IMPORT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

const formSchema = z.object({ export: z.instanceof(File) });

async function handleImport(c: Context<AppEnv>, exportFile: File, type: ImportRequest["type"]) {
  // Reject oversized uploads before reading the full body into memory
  if (exportFile.size > MAX_UPLOAD_BYTES) {
    return c.json({ success: false, error: "Upload too large (max 50 MB)" }, 413);
  }
  const ctx = c.get("ctx");
  const agent = await ctx.getSessionAgent();
  if (!agent) {
    return c.json({ success: false, error: "Invalid Session" }, 401);
  }

  // Read the stored OAuth session to pass to the worker
  const storedSession = await ctx.kv.get<import("@atcute/oauth-node-client").StoredSession>(
    `auth_session:${agent.did}`,
  );
  if (!storedSession) {
    return c.json({ success: false, error: "Session not found" }, 401);
  }

  const csvData = await exportFile.arrayBuffer();

  return streamSSE(c, async (stream) => {
    const importKey = type === "goodreads" ? LABEL.import.goodreads : LABEL.import.storygraph;
    const end = importBatchDuration.startTimer(importKey);
    activeOperations.inc(LABEL.op.import);

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), IMPORT_TIMEOUT_MS);

    const worker = new Worker(new URL("../workers/import/index.ts", import.meta.url));

    const cleanup = () => {
      clearTimeout(timeout);
      worker.terminate();
    };

    ac.signal.addEventListener("abort", () => {
      cleanup();
      stream
        .writeSSE({
          data: JSON.stringify({
            event: "import-error",
            stage: "error",
            stageProgress: { message: "Import timed out after 5 minutes" },
            error: "Import timed out after 5 minutes",
          }),
        })
        .catch(() => {});
    });

    stream.onAbort(() => {
      if (!ac.signal.aborted) ac.abort();
    });

    // Promise that resolves when the worker finishes (done, error, or timeout)
    const done = new Promise<void>((resolve) => {
      ac.signal.addEventListener("abort", () => resolve());

      worker.onmessage = async (event: MessageEvent<ImportWorkerMessage>) => {
        const msg = event.data;
        if (msg.type === "wide-event") {
          // Worker observability events — merge into request-scoped wide event
          ctx.addWideEventContext(msg.context);
          return;
        } else if (msg.type === "sse") {
          await stream.writeSSE({ data: msg.data });
        } else if (msg.type === "done") {
          if (msg.error) {
            await stream.writeSSE({
              data: JSON.stringify({
                event: "import-error",
                stage: "error",
                stageProgress: { message: `Import failed: ${msg.error}` },
                error: msg.error,
              }),
            });
          }
          cleanup();
          resolve();
        }
      };

      worker.onerror = async (event) => {
        await stream.writeSSE({
          data: JSON.stringify({
            event: "import-error",
            stage: "error",
            stageProgress: { message: "Import worker crashed" },
            error: event.message || "Worker error",
          }),
        });
        cleanup();
        resolve();
      };
    });

    const request: ImportRequest = {
      type,
      storedSession,
      csvData,
      databaseUrl: env.DATABASE_URL,
    };

    // Send SSE keepalives every 5s to prevent Bun's idle timeout (default 10s)
    // from killing the connection while the worker is starting up.
    const heartbeat = setInterval(() => {
      stream.writeSSE({ data: "", event: "keepalive" }).catch(() => {});
    }, 5_000);

    try {
      worker.postMessage(request, [csvData]);
      await done;
    } finally {
      clearInterval(heartbeat);
      end();
      activeOperations.dec(LABEL.op.import);
    }
  });
}

const importApp = new Hono<AppEnv>();

importApp.post("/goodreads", zValidator("form", formSchema), async (c) =>
  handleImport(c, c.req.valid("form").export, "goodreads"),
);

importApp.post("/storygraph", zValidator("form", formSchema), async (c) =>
  handleImport(c, c.req.valid("form").export, "storygraph"),
);

export default importApp;
