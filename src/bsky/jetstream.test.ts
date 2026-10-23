import { afterEach, describe, expect, it } from "bun:test";
import type { JetstreamSubscription } from "@atcute/jetstream";
import { JETSTREAM_CURSOR_KEY, startJetstream } from "./jetstream";
import { testKv } from "../test/db";

type StreamEvent = JetstreamSubscription extends AsyncIterable<infer Event> ? Event : never;

// Like the installed EventIterator, return() deliberately leaves pending next() unresolved.
function fakeStream(events: StreamEvent[] = []) {
  let returned = false;
  const iterator: AsyncIterableIterator<StreamEvent> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: async () =>
      events.length
        ? { done: false, value: events.shift()! }
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
  it("closes an idle iterator and reconnects from the durable cursor", async () => {
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
        const stream = fakeStream(streams.length ? [] : [commit(time)]);
        streams.push(stream);
        return stream;
      },
      handleEvent: async () => {},
      emit: (event) => logs.push(event),
      stallMs: 25,
      checkMs: 5,
      retryMs: 1,
    });
    await until(() => streams.length === 2);
    expect(streams[0]!.returned).toBe(true);
    expect(cursors).toEqual([undefined, time]);
    expect(Number(await kv.get(JETSTREAM_CURSOR_KEY))).toBe(time);
    expect(logs.some((event) => event["outcome"] === "stalled")).toBe(true);
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

  it("logs falling behind and catching up", async () => {
    const kv = testKv();
    const outcomes: unknown[] = [];
    stop = startJetstream({
      kv,
      options: { url: "wss://unused" },
      subscribe: () =>
        fakeStream([commit((Date.now() - 3_600_000) * 1000), commit(Date.now() * 1000)]),
      handleEvent: async () => {},
      emit: (event) => outcomes.push(event["outcome"]),
    });
    await until(() => outcomes.includes("caught_up"));
    expect(outcomes).toContain("behind");
  });
});
