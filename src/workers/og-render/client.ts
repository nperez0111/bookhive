import type { OgCard, OgRenderRequest, OgRenderResponse } from "./types";
import { getLogger } from "../../logger/index.ts";

// @takumi-rs/core (native NAPI-RS bindings) is loaded at runtime inside the OG
// render worker thread. It's pulled into .output/server/node_modules/ via
// Nitro's `traceDeps: ["@takumi-rs/core*"]` config (see vite.config.ts), so it
// does not need to appear in this module's bundle graph.

let worker: Worker | null = null;
const pending = new Map<
  string,
  { resolve: (buf: ArrayBuffer) => void; reject: (err: Error) => void; timer: Timer }
>();

const RENDER_TIMEOUT_MS = 10_000;
/** Renders queued on the single worker before we shed load. */
const MAX_PENDING = 32;
/** Timeouts in a row before the worker is presumed wedged and recycled. */
const MAX_CONSECUTIVE_TIMEOUTS = 3;

let consecutiveTimeouts = 0;

const logger = getLogger({ name: "og-render" });

function getWorker(): Worker {
  if (worker) return worker;

  const isBundled = import.meta.url.includes(".output/");
  const workerUrl = isBundled
    ? new URL("./workers/og-render-worker.js", import.meta.url).href
    : new URL("./og-render-worker.tsx", import.meta.url).href;

  worker = new Worker(workerUrl);

  worker.onmessage = (event: MessageEvent<OgRenderResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;

    pending.delete(msg.id);
    clearTimeout(entry.timer);
    consecutiveTimeouts = 0;

    if (msg.ok) {
      entry.resolve(msg.buffer);
    } else {
      entry.reject(new Error(msg.error));
    }
  };

  worker.onerror = (event) => {
    logger.error({ msg: "og_render_worker_error", error: event.message });
    destroyOgRenderWorker();
  };

  return worker;
}

export function renderOgImage(card: OgCard): Promise<ArrayBuffer> {
  const id = crypto.randomUUID();

  if (pending.size >= MAX_PENDING) {
    return Promise.reject(new Error("OG render queue is full"));
  }

  const w = getWorker();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      consecutiveTimeouts++;
      logger.error({
        msg: "og_render_timeout",
        card_kind: card.kind,
        consecutive_timeouts: consecutiveTimeouts,
        pending: pending.size,
      });
      // Only recycle once the worker looks genuinely wedged. Tearing it down on
      // the first timeout also rejected every *other* in-flight render ("Worker
      // terminated"), turning one slow card into a burst of 500s.
      if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
        destroyOgRenderWorker();
      }
      reject(new Error("OG render timed out"));
    }, RENDER_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    w.postMessage({ type: "render", id, card } satisfies OgRenderRequest);
  });
}

export function destroyOgRenderWorker() {
  worker?.terminate();
  worker = null;
  consecutiveTimeouts = 0;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Worker terminated"));
  }
  pending.clear();
}
