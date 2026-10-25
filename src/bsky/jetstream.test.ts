import { afterEach, describe, expect, it } from "bun:test";
import type { CursorStore, SubscribeEventsMessage } from "@atcute/jetstream";
import { jetstreamCursorKey, startJetstream } from "./jetstream";
import { testKv } from "../test/db";
import { Book } from "./lexicon";

type StreamEvent = SubscribeEventsMessage;
const SERVICE = "wss://unused";
const CURSOR_KEY = jetstreamCursorKey(SERVICE);

// Like the installed EventIterator, return() deliberately leaves pending next() unresolved.
function fakeStream(
  events: StreamEvent[] = [],
  finite = false,
  onStart = async () => {},
  onResume: (event: StreamEvent) => Promise<void> = async () => {},
) {
  let returned = false;
  let started = false;
  let yielded: StreamEvent | undefined;
  const iterator: AsyncIterableIterator<StreamEvent> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: async () => {
      if (!started) {
        started = true;
        await onStart();
      }
      // Match subscribeEvents: acknowledge a yield only when the consumer resumes.
      if (yielded) await onResume(yielded);
      yielded = events.shift();
      return yielded
        ? { done: false, value: yielded }
        : finite
          ? { done: true, value: undefined }
          : new Promise<IteratorResult<StreamEvent>>(() => {});
    },
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

function commit(seq: number): StreamEvent {
  return {
    $type: "network.bsky.jetstream.subscribeEvents#commit",
    seq,
    time: "2026-10-25T00:00:00.000Z",
    did: "did:plc:test",
    operation: "delete",
    collection: "buzz.bookhive.book",
    rkey: "aaa",
    rev: "3jzfcijpj2z2a",
  };
}

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for stream");
    await Bun.sleep(2);
  }
}

let stop: (() => Promise<void>) | undefined;
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  await stop?.();
  stop = undefined;
  for (const server of servers.splice(0)) await server.stop(true);
});

describe("Jetstream recovery", () => {
  it("reconnects after iterator completion from the durable cursor", async () => {
    const kv = testKv();
    const seq = 100;
    const streams: ReturnType<typeof fakeStream>[] = [];
    const cursors: Array<number | undefined> = [];
    const logs: Record<string, unknown>[] = [];
    stop = startJetstream({
      kv,
      options: { service: SERVICE },
      subscribe: ({ cursor }) => {
        const stream = fakeStream(
          streams.length ? [] : [commit(seq)],
          streams.length === 0,
          async () => {
            cursors.push(await (cursor as CursorStore).load());
          },
          async (event) => (cursor as CursorStore).save(event.seq),
        );
        streams.push(stream);
        return stream;
      },
      handleEvent: async () => {},
      emit: (event) => logs.push(event),
      retryMs: 1,
    });
    await until(() => cursors.length === 2);
    expect(streams[0]!.returned).toBe(true);
    expect(cursors).toEqual([undefined, seq]);
    expect(Number(await kv.get(CURSOR_KEY))).toBe(seq);
    expect(logs.some((event) => event["outcome"] === "reconnecting")).toBe(true);
    await stop();
    stop = undefined;
    await Bun.sleep(35);
    expect(streams.length).toBe(2);
    expect(streams[1]!.returned).toBe(true);
  });

  it("does not advance the checkpoint when applying an event throws", async () => {
    const kv = testKv();
    await kv.set(CURSOR_KEY, "123");
    const cursors: Array<number | undefined> = [];
    stop = startJetstream({
      kv,
      options: { service: SERVICE },
      subscribe: ({ cursor }) => {
        return fakeStream(
          cursors.length === 0 ? [commit(456)] : [],
          false,
          async () => {
            cursors.push(await (cursor as CursorStore).load());
          },
          async (event) => (cursor as CursorStore).save(event.seq),
        );
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
      options: { service: SERVICE },
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

  it("starts v2 at the live tip without reusing a v1 or another instance's cursor", async () => {
    const kv = testKv();
    await kv.set("jetstream:cursor", String(Date.now() * 1000));
    await kv.set(jetstreamCursorKey("wss://other-instance"), "987");
    const cursors: Array<number | undefined> = [];
    stop = startJetstream({
      kv,
      options: { service: SERVICE },
      subscribe: ({ cursor, kinds, validateEvents, cursorSaveInterval }) => {
        expect(kinds).toEqual(["commit"]);
        expect(validateEvents).toBe(true);
        expect(cursorSaveInterval).toBe(0);
        return fakeStream(
          [commit(0)],
          false,
          async () => {
            cursors.push(await (cursor as CursorStore).load());
          },
          async (event) => (cursor as CursorStore).save(event.seq),
        );
      },
      handleEvent: async () => {},
      emit: () => {},
    });
    await until(async () => (await kv.get(CURSOR_KEY)) !== null);
    await stop();
    stop = undefined;
    expect(cursors).toEqual([undefined]);
    expect(await kv.get(CURSOR_KEY)).not.toBeNull();
    expect(Number(await kv.get(CURSOR_KEY))).toBe(0);
    expect(Number(await kv.get(jetstreamCursorKey("wss://other-instance")))).toBe(987);
  });

  it("persists through the library's save hook only after handling finishes", async () => {
    const kv = testKv();
    await kv.set(CURSOR_KEY, "123");
    let store!: CursorStore;
    let handling = false;
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    stop = startJetstream({
      kv,
      options: { service: SERVICE },
      subscribe: ({ cursor }) => {
        store = cursor as CursorStore;
        return fakeStream(
          [commit(456)],
          false,
          async () => {},
          async (event) => store.save(event.seq),
        );
      },
      handleEvent: async () => {
        handling = true;
        await write;
      },
      emit: () => {},
    });
    try {
      await until(() => handling);
      expect(await store.load()).toBe(123);
      expect(Number(await kv.get(CURSOR_KEY))).toBe(123);
    } finally {
      finishWrite();
    }
    await until(async () => (await store.load()) === 456);
    await stop();
    stop = undefined;
    expect(await store.load()).toBe(456);
  });
});

const DID = "did:plc:enu2j5xjlqsjaylv3du4myh4";
const REV = "3jzfcijpj2z2a";
const CID = "bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const book = {
  $type: "buzz.bookhive.book",
  hiveId: "bk_test",
  title: "Dune",
  authors: "Frank Herbert",
  createdAt: "2026-10-25T00:00:00.000Z",
};

function wireCommit(seq: number) {
  return {
    $type: "network.bsky.jetstream.subscribeEvents#commit",
    did: DID,
    seq,
    time: "2026-10-25T00:00:00.000Z",
    operation: "create",
    collection: "buzz.bookhive.book",
    rkey: REV,
    rev: REV,
    cid: CID,
    record: book,
  };
}

// Exercise the installed v2 client's JSON subprotocol, validation and socket reconnects.
function serve(
  events: unknown[] | (() => unknown[]),
  requests: URL[] = [],
  sockets: Array<{ close(): void }> = [],
) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      requests.push(new URL(request.url));
      if (server.upgrade(request, { headers: { "Sec-WebSocket-Protocol": "xrpc.v1.json" } }))
        return;
      return new Response("WebSocket required", { status: 400 });
    },
    websocket: {
      open(socket) {
        sockets.push(socket);
        for (const payload of typeof events === "function" ? events() : events) {
          socket.send(JSON.stringify({ $type: "message", payload }));
        }
      },
      message() {},
    },
  });
  servers.push(server);
  return `ws://127.0.0.1:${server.port}`;
}

describe("installed Jetstream v2 client", () => {
  it("requests only commits, checkpoints after handling and aborts a quiet pending read", async () => {
    const logs: Record<string, unknown>[] = [];
    const requests: URL[] = [];
    const kv = testKv();
    const service = serve([wireCommit(200)], requests);
    let handling = false;
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    stop = startJetstream({
      kv,
      options: { service, collections: ["buzz.bookhive.book"] },
      emit: (event) => logs.push(event),
      handleEvent: async (event) => {
        expect(event).toMatchObject(wireCommit(200));
        handling = true;
        await write;
        handling = false;
      },
    });
    try {
      await until(() => handling);
      expect(requests[0]!.pathname).toBe("/xrpc/network.bsky.jetstream.subscribeEvents");
      expect(requests[0]!.searchParams.getAll("kinds")).toEqual(["commit"]);
      expect(requests[0]!.searchParams.getAll("collections")).toEqual(["buzz.bookhive.book"]);
      expect(requests[0]!.searchParams.has("cursor")).toBe(false);
      expect(await kv.get(jetstreamCursorKey(service))).toBeNull();
      expect(logs.some((event) => event["outcome"] === "invalid_event")).toBe(false);
    } finally {
      finishWrite();
    }
    // Wait for the library's post-yield save, then abort its quiet pending read.
    await until(async () => Number(await kv.get(jetstreamCursorKey(service))) === 200);
    await stop();
    stop = undefined;
    expect(Number(await kv.get(jetstreamCursorKey(service)))).toBe(200);
    expect(requests).toHaveLength(1);
  });

  it("rejects malformed v2 envelopes without letting their sequence skip a valid commit", async () => {
    const valid = wireCommit(200);
    const future = { ...valid, seq: 900_000_000 };
    const malformed = [
      { ...future, did: "not-a-did" },
      { ...future, time: "not-a-date" },
      { ...future, seq: "900000000" },
      { ...future, seq: 1.25 },
      { ...future, rev: "not-a-tid" },
      { ...future, collection: "not-an-nsid" },
      { ...future, rkey: "invalid/key" },
      { ...future, cid: "not-a-cid" },
      { ...future, operation: null },
    ];
    const logs: Record<string, unknown>[] = [];
    const applied: number[] = [];
    const kv = testKv();
    const service = serve([...malformed, valid]);
    stop = startJetstream({
      kv,
      options: { service },
      handleEvent: async (event) => {
        applied.push(event.seq);
      },
      emit: (event) => logs.push(event),
    });
    await until(async () => Number(await kv.get(jetstreamCursorKey(service))) === 200);
    await stop();
    stop = undefined;
    expect(applied).toEqual([200]);
    expect(logs.filter((event) => event["outcome"] === "invalid_event")).toHaveLength(
      malformed.length,
    );
    expect(Number(await kv.get(jetstreamCursorKey(service)))).toBe(200);
  });

  it("resumes from the saved sequence and deduplicates the inclusive replay", async () => {
    const requests: URL[] = [];
    const kv = testKv();
    const service = serve([wireCommit(100), wireCommit(200)], requests);
    await kv.set(jetstreamCursorKey(service), "100");
    const applied: number[] = [];
    stop = startJetstream({
      kv,
      options: { service },
      handleEvent: async (event) => {
        applied.push(event.seq);
      },
      emit: () => {},
    });
    await until(async () => Number(await kv.get(jetstreamCursorKey(service))) === 200);
    await stop();
    stop = undefined;
    expect(requests[0]!.searchParams.get("cursor")).toBe("100");
    expect(applied).toEqual([200]);
    expect(Number(await kv.get(jetstreamCursorKey(service)))).toBe(200);
  });

  it("reloads the durable sequence on library-managed socket reconnects", async () => {
    const requests: URL[] = [];
    const sockets: Array<{ close(): void }> = [];
    const kv = testKv();
    const service = serve(
      () => (requests.length === 1 ? [wireCommit(100)] : [wireCommit(100), wireCommit(200)]),
      requests,
      sockets,
    );
    const applied: number[] = [];
    stop = startJetstream({
      kv,
      options: {
        service,
        ws: { minReconnectionDelay: 1, maxReconnectionDelay: 1, minUptime: 0 },
      },
      handleEvent: async (event) => {
        applied.push(event.seq);
      },
      emit: () => {},
    });
    await until(async () => Number(await kv.get(jetstreamCursorKey(service))) === 100);
    sockets[0]!.close();
    await until(async () => Number(await kv.get(jetstreamCursorKey(service))) === 200);
    await stop();
    stop = undefined;
    expect(requests[1]!.searchParams.get("cursor")).toBe("100");
    expect(applied).toEqual([100, 200]);
    expect(Number(await kv.get(jetstreamCursorKey(service)))).toBe(200);
  });

  it("does not save a failed handler's sequence when returning and reconnecting", async () => {
    const requests: URL[] = [];
    const kv = testKv();
    const service = serve([wireCommit(100), wireCommit(200)], requests);
    await kv.set(jetstreamCursorKey(service), "50");
    const applied: number[] = [];
    stop = startJetstream({
      kv,
      options: { service },
      handleEvent: async (event) => {
        if (event.seq === 200) throw new Error("write failed");
        applied.push(event.seq);
      },
      emit: () => {},
      retryMs: 1,
    });
    await until(() => requests.length >= 2);
    await stop();
    stop = undefined;
    expect(applied).toEqual([100]);
    expect(requests[1]!.searchParams.get("cursor")).toBe("100");
    expect(Number(await kv.get(jetstreamCursorKey(service)))).toBe(100);
  });

  it("keeps shutdown flushes behind a handler still in flight", async () => {
    const kv = testKv();
    const service = serve([wireCommit(100), wireCommit(200)]);
    let handling = false;
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    stop = startJetstream({
      kv,
      options: { service },
      handleEvent: async (event) => {
        if (event.seq === 200) {
          handling = true;
          await write;
        }
      },
      emit: () => {},
    });
    let stopping: Promise<void> | undefined;
    try {
      await until(() => handling);
      stopping = stop();
      expect(Number(await kv.get(jetstreamCursorKey(service)))).toBe(100);
    } finally {
      finishWrite();
      await stopping;
    }
    stop = undefined;
    expect(Number(await kv.get(jetstreamCursorKey(service)))).toBe(100);
  });

  it("retains separate BookHive record validation for structurally valid envelopes", async () => {
    const kv = testKv();
    const service = serve([
      { ...wireCommit(100), record: { ...book, title: "" } },
      wireCommit(200),
    ]);
    const records: boolean[] = [];
    const logs: Record<string, unknown>[] = [];
    stop = startJetstream({
      kv,
      options: { service },
      handleEvent: async (event) => {
        records.push(Book.validateRecord(event.record).success);
      },
      emit: (event) => logs.push(event),
    });
    await until(() => records.length === 2);
    await stop();
    stop = undefined;
    expect(records).toEqual([false, true]);
    expect(logs.some((event) => event["outcome"] === "invalid_event")).toBe(false);
  });
});
