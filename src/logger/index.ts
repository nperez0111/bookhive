import pino from "pino";
import { Writable } from "stream";
import { env } from "../env";

// When running the Nitro bundle (.output/server/), load pre-built workers.
// In dev, Bun runs the .ts source directly.
const isBundled = import.meta.url.includes(".output/");

let loggerWorker: Worker | null = null;

function createOpenObserveStream(): Writable | null {
  if (env.isDev || !env.OPEN_OBSERVE_URL || !env.OPEN_OBSERVE_USER || !env.OPEN_OBSERVE_PASSWORD) {
    return null;
  }

  const workerUrl = isBundled
    ? new URL("./logger/open-observe-worker.js", import.meta.url).href
    : new URL("../workers/open-observe-worker.ts", import.meta.url).href;

  loggerWorker = new Worker(workerUrl);
  loggerWorker.postMessage({
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
  loggerWorker.onerror = (event) => {
    console.error("OpenObserve logger worker error:", event.message);
  };

  return new Writable({
    write(chunk, _, callback) {
      loggerWorker!.postMessage({ type: "log", data: chunk.toString() });
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
  loggerWorker?.terminate();
}
