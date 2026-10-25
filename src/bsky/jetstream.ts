import { JetstreamSubscription, type JetstreamSubscriptionOptions } from "@atcute/jetstream";
import { setTimeout as delay } from "node:timers/promises";
import type { Storage } from "unstorage";
import { errorMessage } from "../lib/errors";

type StreamEvent = JetstreamSubscription extends AsyncIterable<infer Event> ? Event : never;
type Subscription = { [Symbol.asyncIterator](): AsyncIterableIterator<StreamEvent> };

export const JETSTREAM_CURSOR_KEY = "jetstream:cursor";

/** Own the iterator, not just the subscription: returning it closes the socket. */
export function startJetstream({
  kv,
  options,
  handleEvent,
  emit,
  subscribe = (options) => new JetstreamSubscription(options),
  retryMs = 3_000,
}: {
  kv: Storage;
  options: JetstreamSubscriptionOptions;
  handleEvent: (event: StreamEvent) => Promise<void>;
  emit: (event: Record<string, unknown>) => void;
  subscribe?: (options: JetstreamSubscriptionOptions) => Subscription;
  retryMs?: number;
}): () => Promise<void> {
  const stop = new AbortController();
  let closeCurrent: (() => Promise<unknown>) | undefined;
  const log = (outcome: string, fields: Record<string, unknown> = {}) =>
    emit({ msg: "ingester", outcome, ...fields, timestamp: new Date().toISOString() });

  const task = (async () => {
    while (!stop.signal.aborted) {
      try {
        const saved = await kv.get<string>(JETSTREAM_CURSOR_KEY);
        if (stop.signal.aborted) break;
        const cursor = saved && Number.isFinite(Number(saved)) ? Number(saved) : undefined;
        log("connecting", { cursor, resume_lag_ms: cursor ? Date.now() - cursor / 1000 : null });
        const subscription = subscribe({
          ...options,
          cursor,
          onError: (error) => log("invalid_event", { error: { message: errorMessage(error) } }),
          onConnectionError: (event) =>
            log("connection_error", { error: { message: errorMessage(event.error) } }),
        });
        const iterator = subscription[Symbol.asyncIterator]();
        let cancelRead: (() => void) | undefined;
        let closing = false;
        closeCurrent = async () => {
          closing = true;
          // EventIterator.return() closes the socket but does NOT settle a pending next().
          cancelRead?.();
          return iterator.return?.();
        };
        while (!closing) {
          // One cancel callback per read; repeatedly racing a shared never-settled promise
          // would retain a handler for every received event until the connection closes.
          const result = await new Promise<IteratorResult<StreamEvent>>((resolve, reject) => {
            cancelRead = () => resolve({ done: true, value: undefined });
            iterator.next().then(resolve, reject);
          }).finally(() => {
            cancelRead = undefined;
          });
          if (result.done) break;
          const event = result.value;
          if (stop.signal.aborted || closing) break;
          if (event.kind !== "commit") continue;
          await handleEvent(event);
          // Serialize durable checkpoints; reconnect must not use the socket's ahead-of-DB cursor.
          await kv.set(JETSTREAM_CURSOR_KEY, String(event.time_us));
        }
      } catch (error) {
        if (!stop.signal.aborted) log("stream_error", { error: { message: errorMessage(error) } });
      } finally {
        await closeCurrent?.().catch(() => {});
        closeCurrent = undefined;
      }
      if (!stop.signal.aborted) {
        log("reconnecting");
        await delay(retryMs, undefined, { signal: stop.signal }).catch(() => {});
      }
    }
  })();

  return async () => {
    stop.abort();
    await closeCurrent?.();
    await task;
  };
}
