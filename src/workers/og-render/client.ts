import type { OgCard, OgRenderRequest, OgRenderResponse } from "./types";

let worker: Worker | null = null;
const pending = new Map<
  string,
  { resolve: (buf: ArrayBuffer) => void; reject: (err: Error) => void; timer: Timer }
>();

const RENDER_TIMEOUT_MS = 10_000;

function getWorker(): Worker {
  if (worker) return worker;

  const isBundled = import.meta.url.includes(".output/");
  const workerUrl = isBundled
    ? new URL("./workers/og-render/og-render-worker.js", import.meta.url).href
    : new URL("./og-render-worker.tsx", import.meta.url).href;

  worker = new Worker(workerUrl);

  worker.onmessage = (event: MessageEvent<OgRenderResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;

    pending.delete(msg.id);
    clearTimeout(entry.timer);

    if (msg.ok) {
      entry.resolve(msg.buffer);
    } else {
      entry.reject(new Error(msg.error));
    }
  };

  worker.onerror = (event) => {
    console.error("OG render worker error:", event.message);
    destroyOgRenderWorker();
  };

  return worker;
}

export function renderOgImage(card: OgCard): Promise<ArrayBuffer> {
  const id = crypto.randomUUID();
  const w = getWorker();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("OG render timed out"));
      // Terminate the hung worker so next call spawns a fresh one
      destroyOgRenderWorker();
    }, RENDER_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    w.postMessage({ type: "render", id, card } satisfies OgRenderRequest);
  });
}

export function destroyOgRenderWorker() {
  worker?.terminate();
  worker = null;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("Worker terminated"));
  }
  pending.clear();
}
