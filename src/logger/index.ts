import pino from "pino";
import { Writable } from "stream";
import { env } from "../env";
import { LogShippingCredits, type WorkerReply } from "./openObserve";

// When running the Nitro bundle (.output/server/), load pre-built workers.
// In dev, Bun runs the .ts source directly.
const isBundled = import.meta.url.includes(".output/");

let loggerWorker: Worker | null = null;
let shippingCredits: LogShippingCredits | null = null;

/** Covers mailbox + queue + active HTTP payload, without inspecting serialized log contents. */
export function getLogShippingStats() {
  return shippingCredits?.stats() ?? null;
}

function createOpenObserveStream(): Writable | null {
  if (env.isDev || !env.OPEN_OBSERVE_URL || !env.OPEN_OBSERVE_USER || !env.OPEN_OBSERVE_PASSWORD) {
    return null;
  }

  const workerUrl = isBundled
    ? new URL("./workers/open-observe-worker.js", import.meta.url).href
    : new URL("../workers/open-observe-worker.ts", import.meta.url).href;

  const worker = new Worker(workerUrl, { ref: false });
  loggerWorker = worker;
  const credits = new LogShippingCredits();
  shippingCredits = credits;
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    if (event.data.type === "disabled") credits.disable();
    else credits.acknowledge(event.data);
  };
  worker.addEventListener("close", () => credits.closed());
  worker.postMessage({
    type: "init",
    options: {
      url: env.OPEN_OBSERVE_URL,
      organization: "bookhive",
      streamName: "server-logs",
      auth: {
        username: env.OPEN_OBSERVE_USER,
        password: env.OPEN_OBSERVE_PASSWORD,
      },
    },
  });
  worker.onerror = (event) => {
    credits.disable();
    worker.terminate();
    console.error("OpenObserve logger worker error:", event.message);
  };

  return new Writable({
    write(chunk, _, callback) {
      const message = credits.admit(chunk.toString());
      if (message) {
        try {
          worker.postMessage(message);
        } catch {
          credits.acknowledge({ type: "ack", ids: [message.id], result: "dropped" });
          credits.disable();
          worker.terminate();
        }
      }
      // Never backpressure pino/stdout behind optional remote logging.
      callback();
    },
  });
}

const ooStream = createOpenObserveStream();

export function getLogger(options: pino.LoggerOptions) {
  const base = { level: env.LOG_LEVEL, ...options };
  if (!ooStream) return pino(base);

  // Write to both stdout and the OpenObserve worker thread.
  return pino(base, pino.multistream([{ stream: pino.destination(1) }, { stream: ooStream }]));
}

/** Terminate the logger worker thread. Call during server shutdown. */
export function destroyLogger() {
  shippingCredits?.disable();
  loggerWorker?.terminate();
  loggerWorker = null;
}
