import {
  subscribeEvents,
  type SubscribeEventsMessage,
  type SubscribeEventsOptions,
} from "@atcute/jetstream";
import { setTimeout as delay } from "node:timers/promises";
import type { Storage } from "unstorage";
import { errorMessage } from "../lib/errors";

type StreamCommit = Extract<
  SubscribeEventsMessage,
  { $type?: "network.bsky.jetstream.subscribeEvents#commit" }
>;
type Subscription = AsyncIterable<SubscribeEventsMessage>;

// V2 sequences belong to one instance; never reuse the old v1 timestamp checkpoint.
export const jetstreamCursorKey = (service: string) =>
  `jetstream:v2:${new URL(service).host}:cursor`;

/** The subscription checkpoints handled commits; aborting it cancels pending reads. */
export function startJetstream({
  kv,
  options,
  handleEvent,
  emit,
  subscribe = subscribeEvents,
  retryMs = 3_000,
}: {
  kv: Storage;
  options: Pick<SubscribeEventsOptions, "service" | "collections" | "ws">;
  handleEvent: (event: StreamCommit) => Promise<void>;
  emit: (event: Record<string, unknown>) => void;
  subscribe?: (options: SubscribeEventsOptions) => Subscription;
  retryMs?: number;
}): () => Promise<void> {
  const stop = new AbortController();
  const cursorKey = jetstreamCursorKey(options.service);
  let closeCurrent: (() => Promise<unknown>) | undefined;
  const log = (outcome: string, fields: Record<string, unknown> = {}) =>
    emit({ msg: "ingester", outcome, ...fields, timestamp: new Date().toISOString() });

  const task = (async () => {
    while (!stop.signal.aborted) {
      try {
        const connection = new AbortController();
        const subscription = subscribe({
          ...options,
          kinds: ["commit"],
          validateEvents: true,
          cursorSaveInterval: 0,
          signal: connection.signal,
          cursor: {
            // Called for library-managed socket reconnects too, not only this outer loop.
            async load() {
              const saved = await kv.get<string>(cursorKey);
              const seq = saved == null ? undefined : Number(saved);
              const cursor =
                seq !== undefined && Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
              log("connecting", { service: options.service, cursor });
              return cursor;
            },
            async save(seq) {
              await kv.set(cursorKey, String(seq));
            },
          },
          onError: (error) => log("invalid_event", { error: { message: errorMessage(error) } }),
          onInfo: (info) => log("stream_info", { info }),
          onConnectionError: (event) =>
            log("connection_error", { error: { message: errorMessage(event.error) } }),
        });
        const iterator = subscription[Symbol.asyncIterator]();
        let cancelRead: (() => void) | undefined;
        let closing = false;
        closeCurrent = async () => {
          closing = true;
          // Abort settles the v2 generator's pending read before return() can finish.
          connection.abort();
          cancelRead?.();
          return iterator.return?.();
        };
        while (!closing) {
          // One cancel callback per read; repeatedly racing a shared never-settled promise
          // would retain a handler for every received event until the connection closes.
          const result = await new Promise<IteratorResult<SubscribeEventsMessage>>(
            (resolve, reject) => {
              cancelRead = () => resolve({ done: true, value: undefined });
              iterator.next().then(resolve, reject);
            },
          ).finally(() => {
            cancelRead = undefined;
          });
          if (result.done) break;
          const event = result.value;
          if (stop.signal.aborted || closing) break;
          if (event.$type !== "network.bsky.jetstream.subscribeEvents#commit") continue;
          // Requesting the next event lets the library save this sequence only after
          // handling succeeds. return() skips that acknowledgement on handler failure.
          await handleEvent(event);
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
