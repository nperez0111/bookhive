/**
 * Bun Worker entry point for CSV import processing.
 * Receives an ImportRequest via postMessage, processes the import,
 * and relays SSE events back to the main thread.
 */
import {
  ImportType,
  type ImportRequest,
  type ImportWorkerMessage,
  type ImportSseAck,
} from "./types";
import { createWorkerContext } from "./context";
import { processGoodreadsImport, processStorygraphImport, processHardcoverImport } from "./logic";
import { errorMessage } from "../../lib/errors";

declare var self: Worker;

let acknowledgeSSE: (() => void) | undefined;
self.onmessage = async (event: MessageEvent<ImportRequest | ImportSseAck>) => {
  if (event.data.type === "sse-ack") {
    acknowledgeSSE?.();
    acknowledgeSSE = undefined;
    return;
  }
  const { type, storedSession, csvData, dbPath, kvPath } = event.data;

  try {
    const { ctx, agent } = await createWorkerContext({ storedSession, dbPath, kvPath });

    // Every emitter is awaited. Keep at most one outstanding progress event,
    // rather than retaining a row/event per book when the browser reads slowly.
    const onSSE = (data: string) =>
      new Promise<void>((resolve) => {
        acknowledgeSSE = resolve;
        self.postMessage({ type: "sse", data } satisfies ImportWorkerMessage);
      });

    if (type === ImportType.goodreads) {
      await processGoodreadsImport({ csvData, ctx, agent, onSSE });
    } else if (type === ImportType.storygraph) {
      await processStorygraphImport({ csvData, ctx, agent, onSSE });
    } else if (type === ImportType.hardcover) {
      await processHardcoverImport({ csvData, ctx, agent, onSSE });
    } else {
      throw new Error(`Unknown import type: ${type as never as string}`);
    }

    self.postMessage({ type: "done" } satisfies ImportWorkerMessage);
  } catch (error) {
    self.postMessage({
      type: "done",
      error: errorMessage(error),
    } satisfies ImportWorkerMessage);
  }
};
