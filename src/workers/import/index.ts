/**
 * Bun Worker entry point for CSV import processing.
 * Receives an ImportRequest via postMessage, processes the import,
 * and relays SSE events back to the main thread.
 */
import type { ImportRequest, ImportWorkerMessage } from "./types";
import { createWorkerContext } from "./context";
import { processGoodreadsImport, processStorygraphImport } from "./logic";

declare var self: Worker;

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  const { type, storedSession, csvData, databaseUrl } = event.data;

  try {
    const { ctx, agent } = await createWorkerContext({ storedSession, databaseUrl });

    const onSSE = (data: string) => {
      self.postMessage({ type: "sse", data } satisfies ImportWorkerMessage);
    };

    if (type === "goodreads") {
      await processGoodreadsImport({ csvData, ctx, agent, onSSE });
    } else if (type === "storygraph") {
      await processStorygraphImport({ csvData, ctx, agent, onSSE });
    } else {
      throw new Error(`Unknown import type: ${type as never as string}`);
    }

    self.postMessage({ type: "done" } satisfies ImportWorkerMessage);
  } catch (error) {
    self.postMessage({
      type: "done",
      error: error instanceof Error ? error.message : String(error),
    } satisfies ImportWorkerMessage);
  }
};
