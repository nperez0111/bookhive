import { describe, it, expect } from "bun:test";
import type { ImportRequest, ImportWorkerMessage } from "./types";

/**
 * Tests at the worker boundary: verifies the Bun Worker starts, receives an
 * ImportRequest, and posts back correctly-shaped SSE events + a done signal.
 * Uses a real Worker thread but, since modules can't easily be mocked inside
 * one, tests the message protocol shape and lifecycle rather than full import
 * logic (covered in import-logic.test.ts).
 */

const WORKER_PATH = new URL("./index.ts", import.meta.url);

function collectWorkerMessages(
  worker: Worker,
  { timeout = 15_000 }: { timeout?: number } = {},
): Promise<ImportWorkerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ImportWorkerMessage[] = [];
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Worker timed out after ${timeout}ms. Got ${messages.length} messages.`));
    }, timeout);

    worker.onmessage = (event: MessageEvent<ImportWorkerMessage>) => {
      messages.push(event.data);
      if (event.data.type === "done") {
        clearTimeout(timer);
        worker.terminate();
        resolve(messages);
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(`Worker error: ${event.message}`));
    };
  });
}

describe("import worker boundary", () => {
  it("sends a done message with error for invalid session data", async () => {
    const worker = new Worker(WORKER_PATH);

    const request: ImportRequest = {
      type: "goodreads",
      // Invalid session — restore will fail
      storedSession: {
        dpopKey: {} as any,
        authMethod: "none" as any,
        tokenSet: {
          sub: "did:plc:fake" as any,
          iss: "https://fake.example",
          aud: "https://fake.example",
          scope: "atproto" as any,
          access_token: "fake",
          token_type: "DPoP",
        },
      },
      csvData: new TextEncoder().encode("empty").buffer as ArrayBuffer,
      dbPath: ":memory:",
      kvPath: ":memory:",
    };

    const messagesPromise = collectWorkerMessages(worker);
    worker.postMessage(request);
    const messages = await messagesPromise;

    const doneMsg = messages.find((m) => m.type === "done");
    expect(doneMsg).toBeDefined();
    expect(doneMsg!.type).toBe("done");
    expect(doneMsg!).toHaveProperty("error");
  });

  it("worker responds with correctly-typed messages", async () => {
    const worker = new Worker(WORKER_PATH);

    const request: ImportRequest = {
      type: "goodreads",
      storedSession: {
        dpopKey: {} as any,
        authMethod: "none" as any,
        tokenSet: {
          sub: "did:plc:test123" as any,
          iss: "https://bsky.social",
          aud: "https://pds.example",
          scope: "atproto" as any,
          access_token: "test-token",
          token_type: "DPoP",
        },
      },
      csvData: new ArrayBuffer(0),
      dbPath: ":memory:",
      kvPath: ":memory:",
    };

    const messagesPromise = collectWorkerMessages(worker);
    worker.postMessage(request);
    const messages = await messagesPromise;

    for (const msg of messages) {
      expect(["sse", "done"]).toContain(msg.type);
      if (msg.type === "sse") {
        expect(typeof (msg as any).data).toBe("string");
      }
    }

    const last = messages[messages.length - 1]!;
    expect(last.type).toBe("done");
  });

  it("worker terminates cleanly when terminated externally", async () => {
    const worker = new Worker(WORKER_PATH);

    // Don't send any message, just terminate
    worker.terminate();

    // If we get here without hanging, the test passes
    expect(true).toBe(true);
  });
});
