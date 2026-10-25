import { afterEach, describe, expect, it } from "bun:test";
import type { JetstreamSubscription } from "@atcute/jetstream";
import { JETSTREAM_CURSOR_KEY, startJetstream } from "./jetstream";
import { testKv } from "../test/db";

type StreamEvent = JetstreamSubscription extends AsyncIterable<infer Event> ? Event : never;

// Like the installed EventIterator, return() deliberately leaves pending next() unresolved.
function fakeStream(events: StreamEvent[] = [], finite = false) {
  let returned = false;
  const iterator: AsyncIterableIterator<StreamEvent> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: async () =>
      events.length
        ? { done: false, value: events.shift()! }
        : finite
          ? { done: true, value: undefined }
          : new Promise<IteratorResult<StreamEvent>>(() => {}),
    async return() {
      returned = true;
      return { done: true, value: undefined };
    },
  };
  return {
    [Symbol.asyncIterator]: () => iterator,
    get returned() {
      return returned;
    },
  };
}

function commit(time_us: number): StreamEvent {
  return {
    kind: "commit",
    time_us,
    did: "did:plc:test",
    commit: {
      operation: "delete",
      collection: "buzz.bookhive.book",
      rkey: "aaa",
      rev: "aaa",
    },
  };
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for stream");
    await Bun.sleep(2);
  }
}

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe("Jetstream recovery", () => {
  it("reconnects after iterator completion from the durable cursor", async () => {
    const kv = testKv();
    const time = Date.now() * 1000;
    const streams: ReturnType<typeof fakeStream>[] = [];
    const cursors: Array<number | undefined> = [];
    const logs: Record<string, unknown>[] = [];
    stop = startJetstream({
      kv,
      options: { url: "wss://unused" },
      subscribe: ({ cursor }) => {
        cursors.push(cursor);
        const stream = fakeStream(streams.length ? [] : [commit(time)], streams.length === 0);
        streams.push(stream);
        return stream;
      },
      handleEvent: async () => {},
      emit: (event) => logs.push(event),
      retryMs: 1,
    });
    await until(() => streams.length === 2);
    expect(streams[0]!.returned).toBe(true);
    expect(cursors).toEqual([undefined, time]);
    expect(Number(await kv.get(JETSTREAM_CURSOR_KEY))).toBe(time);
    expect(logs.some((event) => event["outcome"] === "reconnecting")).toBe(true);
    await stop();
    stop = undefined;
    await Bun.sleep(35);
    expect(streams.length).toBe(2);
    expect(streams[1]!.returned).toBe(true);
  });

  it("does not advance the checkpoint when applying an event throws", async () => {
    const kv = testKv();
    await kv.set(JETSTREAM_CURSOR_KEY, "123");
    const cursors: Array<number | undefined> = [];
    stop = startJetstream({
      kv,
      options: { url: "wss://unused" },
      subscribe: ({ cursor }) => {
        cursors.push(cursor);
        return fakeStream(cursors.length === 1 ? [commit(456)] : []);
      },
      handleEvent: async () => {
        throw new Error("write failed");
      },
      emit: () => {},
      retryMs: 1,
    });
    await until(() => cursors.length === 2);
    expect(cursors).toEqual([123, 123]);
  });

  it("keeps a quiet subscription open and cancels its pending read on shutdown", async () => {
    const kv = testKv();
    const stream = fakeStream();
    let connections = 0;
    stop = startJetstream({
      kv,
      options: { url: "wss://unused" },
      subscribe: () => {
        connections++;
        return stream;
      },
      handleEvent: async () => {},
      emit: () => {},
    });
    await until(() => connections === 1);
    await Bun.sleep(35);
    expect(connections).toBe(1);
    expect(stream.returned).toBe(false);
    await stop();
    stop = undefined;
    expect(stream.returned).toBe(true);
  });
});
