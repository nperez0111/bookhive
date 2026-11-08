/**
 * Import routes: Goodreads and StoryGraph and Hardcover CSV upload.
 * Spawns a Bun Worker for the heavy processing and relays SSE events.
 * Mount at /import so paths are /import/goodreads, /import/storygraph, /import/hardcover.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { AppEnv } from "../context";
import { ImportType, type ImportRequest } from "../workers/import/types";
import { env } from "../env";
import { activeOperations, importBatchDuration, LABEL } from "../metrics";
import { jsonUnauthorized } from "./authResponse";
import { runImportWorker } from "./importLifecycle";
import type { StoredSession } from "@atcute/oauth-node-client";
import { Semaphore, SemaphoreFullError } from "../lib/semaphore";
import {
  readBoundedMultipart,
  MultipartTooLargeError,
  MultipartTimeoutError,
} from "./boundedMultipart";

const IMPORT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const MULTIPART_SLACK = 64 * 1024;
const importSlots = new Semaphore(1, { label: "csv-import", maxPending: 0 });

export const getImportAdmissionState = () => ({
  active: importSlots.active,
  pending: importSlots.pending,
});

type ImportEnv = AppEnv & {
  Variables: AppEnv["Variables"] & {
    importAdmission: { did: string; release: () => void; running: boolean };
  };
};

const formSchema = z.object({ export: z.instanceof(File) });

async function handleImport(c: Context<ImportEnv>, exportFile: File, type: ImportRequest["type"]) {
  // Multipart bytes are already bounded; enforce the file-only 50 MB limit
  // before making the transferable ArrayBuffer for the worker.
  if (exportFile.size > MAX_UPLOAD_BYTES) {
    return c.json({ success: false, error: "Upload too large (max 50 MB)" }, 413);
  }
  const ctx = c.get("ctx");
  const admission = c.get("importAdmission");

  const csvData = await exportFile.arrayBuffer();
  // Uploading can outlive an OAuth refresh. The worker has an isolated store,
  // so give it the latest grant rather than the pre-upload snapshot.
  const storedSession = await ctx.kv.get<StoredSession>(`auth_session:${admission.did}`);
  if (!storedSession) return jsonUnauthorized(c);

  admission.running = true;
  return streamSSE(c, async (stream) => {
    // default to goodreads
    const importKey =
      type === ImportType.storygraph
        ? LABEL.import.storygraph
        : type === ImportType.hardcover
          ? LABEL.import.hardcover
          : LABEL.import.goodreads;

    const end = importBatchDuration.startTimer(importKey);
    activeOperations.inc(LABEL.op.import);

    const isBundled = import.meta.url.includes(".output/");
    const workerUrl = isBundled
      ? new URL("./workers/import-worker.js", import.meta.url).href
      : new URL("../workers/import/index.ts", import.meta.url).href;

    const request: ImportRequest = {
      type,
      storedSession,
      csvData,
      dbPath: env.DB_PATH,
      kvPath: env.KV_DB_PATH,
    };

    try {
      await runImportWorker({
        stream,
        createWorker: () => new Worker(workerUrl),
        request,
        addWideEventContext: (context) => ctx.addWideEventContext(context),
        timeoutMs: IMPORT_TIMEOUT_MS,
      });
    } finally {
      end();
      activeOperations.dec(LABEL.op.import);
      // The response is returned before the SSE callback finishes. The
      // admission belongs to the worker/stream lifetime, not middleware next().
      admission.release();
    }
  });
}

const importApp = new Hono<ImportEnv>();

// Must precede zValidator("form"): validation itself calls formData().
const admitImport: MiddlewareHandler<ImportEnv> = async (c, next) => {
  const ctx = c.get("ctx");
  const agent = await ctx.getSessionAgent();
  if (!agent) return jsonUnauthorized(c);
  const storedSession = await ctx.kv.get<StoredSession>(`auth_session:${agent.did}`);
  if (!storedSession) return jsonUnauthorized(c);

  let release: () => void;
  try {
    release = await importSlots.acquireSlot();
  } catch (error) {
    if (!(error instanceof SemaphoreFullError)) throw error;
    ctx.addWideEventContext({ import_admission: "busy" });
    return c.json({ success: false, error: "Server is busy — try again in a moment" }, 503);
  }
  const admission = { did: agent.did, release, running: false };
  c.set("importAdmission", admission);
  try {
    try {
      await readBoundedMultipart(c.req, MAX_UPLOAD_BYTES + MULTIPART_SLACK);
    } catch (error) {
      if (error instanceof MultipartTimeoutError) {
        return c.json({ success: false, error: "Upload timed out. Try again." }, 408);
      }
      if (error instanceof MultipartTooLargeError) {
        return c.json({ success: false, error: "Upload too large (max 50 MB)" }, 413);
      }
      return c.json({ success: false, error: "Invalid upload form" }, 400);
    }
    await next();
    return;
  } finally {
    if (!admission.running) release();
  }
};

importApp.post("/goodreads", admitImport, zValidator("form", formSchema), async (c) =>
  handleImport(c, c.req.valid("form").export, ImportType.goodreads),
);

importApp.post("/storygraph", admitImport, zValidator("form", formSchema), async (c) =>
  handleImport(c, c.req.valid("form").export, ImportType.storygraph),
);

importApp.post("/hardcover", admitImport, zValidator("form", formSchema), async (c) =>
  handleImport(c, c.req.valid("form").export, ImportType.hardcover),
);

export default importApp;
