import type { ImportRequest, ImportSseAck, ImportWorkerMessage } from "../workers/import/types";

type ImportWorker = Pick<Worker, "onmessage" | "onerror" | "postMessage" | "terminate">;
type ImportStream = {
  aborted: boolean;
  onAbort: (listener: () => void) => void;
  writeSSE: (message: { data: string; event?: string }) => Promise<unknown>;
};

const ERROR_DRAIN_MS = 1_000;

/** Worker cleanup is immediate; output drains are bounded independently. */
export async function runImportWorker({
  stream,
  createWorker,
  request,
  addWideEventContext,
  timeoutMs,
  timers = globalThis,
}: {
  stream: ImportStream;
  createWorker: () => ImportWorker;
  request: ImportRequest;
  addWideEventContext: (context: Record<string, unknown>) => void;
  timeoutMs: number;
  timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;
}) {
  let worker: ImportWorker | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let errorDrainTimeout: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let terminal = false;
  let heartbeatPending = false;
  let writes = Promise.resolve();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const complete = () => {
    if (timeout !== undefined) timers.clearTimeout(timeout);
    if (errorDrainTimeout !== undefined) timers.clearTimeout(errorDrainTimeout);
    resolveDone();
  };
  const finish = (error?: { message: string; error: string }, drain = !!error) => {
    // Abort/write failure can also interrupt an already-terminal output drain.
    if (!drain) complete();
    if (terminal) return;
    terminal = true;
    if (heartbeat !== undefined) timers.clearInterval(heartbeat);
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    if (error && !stream.aborted) {
      // Hono closes when our callback returns. Give even timeout/startup errors
      // time to write, but never let their output hold the route indefinitely.
      errorDrainTimeout = timers.setTimeout(complete, ERROR_DRAIN_MS);
      writes = writes.then(async () => {
        await stream.writeSSE({
          data: JSON.stringify({
            event: "import-error",
            stage: "error",
            stageProgress: { message: error.message },
            error: error.error,
          }),
        });
      });
    }
    const settled = writes.catch(() => {});
    if (drain) void settled.then(complete);
  };

  const write = (message: { data: string; event?: string }, acknowledge = false) => {
    writes = writes.then(() => stream.writeSSE(message)).then(() => {
      // The worker may emit its next event only after actual stream backpressure
      // clears. A terminal cleanup may have terminated it while the write waited.
      if (acknowledge && !terminal) {
        worker?.postMessage({ type: "sse-ack" } satisfies ImportSseAck);
      }
    });
    // Observe failures without letting an async event handler reject unobserved.
    void writes.catch(() => finish());
    return writes;
  };

  stream.onAbort(() => finish());
  try {
    if (stream.aborted) {
      finish();
    } else {
      worker = createWorker();
      worker.onmessage = (event: MessageEvent<ImportWorkerMessage>) => {
        if (terminal) return;
        const msg = event.data;
        if (msg.type === "wide-event") {
          addWideEventContext(msg.context);
        } else if (msg.type === "sse") {
          void write({ data: msg.data }, true);
        } else {
          finish(
            msg.error ? { message: `Import failed: ${msg.error}`, error: msg.error } : undefined,
            true,
          );
        }
      };
      worker.onerror = (event) => {
        finish({ message: "Import worker crashed", error: event.message || "Worker error" });
      };
      timeout = timers.setTimeout(() => {
        if (terminal) {
          complete();
          return;
        }
        const message = "Import timed out after 5 minutes";
        finish({ message, error: message });
      }, timeoutMs);
      // Keepalives prevent idle timeouts while the worker starts up.
      heartbeat = timers.setInterval(() => {
        // Keep at most one queued/in-flight heartbeat behind a slow SSE write.
        if (terminal || heartbeatPending) return;
        heartbeatPending = true;
        void write({ data: "", event: "keepalive" })
          .finally(() => {
            heartbeatPending = false;
          })
          .catch(() => {});
      }, 5_000);
      worker.postMessage(request, [request.csvData]);
    }
  } catch (error) {
    finish({
      message: "Import worker failed to start",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await done;
}
