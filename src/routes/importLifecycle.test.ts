import { expect, test } from "bun:test";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { runImportWorker } from "./importLifecycle";
import type { ImportRequest, ImportSseAck, ImportWorkerMessage } from "../workers/import/types";

function harness(
  options: {
    writeFails?: boolean;
    postFails?: boolean;
    createFails?: boolean;
    aborted?: boolean;
    writeBlocked?: Promise<void>;
    stream?: Parameters<typeof runImportWorker>[0]["stream"];
  } = {},
) {
  const scheduled = new Map<number, () => void>();
  let nextId = 0;
  const schedule = (callback: () => void) => {
    scheduled.set(++nextId, callback);
    return nextId;
  };
  const clear = (id: number) => {
    scheduled.delete(id);
  };
  const messages: { data: string; event?: string }[] = [];
  const posted: (ImportRequest | ImportSseAck)[] = [];
  let releases = 0;
  let terminations = 0;
  let starts = 0;
  let abort = () => {};
  const worker = {
    onmessage: null as ((event: MessageEvent<ImportWorkerMessage>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: (message: ImportRequest | ImportSseAck) => {
      if (options.postFails) throw new Error("post failed");
      posted.push(message);
    },
    terminate: () => {
      terminations++;
    },
  };
  const stream = {
    aborted: options.aborted ?? false,
    abort: () => {
      if (stream.aborted) return;
      stream.aborted = true;
      abort();
    },
    onAbort: (listener: () => void) => {
      abort = listener;
    },
    writeSSE: async (message: { data: string; event?: string }) => {
      messages.push(message);
      if (options.writeFails) throw new Error("disconnected");
      await options.writeBlocked;
    },
  };
  const contexts: Record<string, unknown>[] = [];
  const done = runImportWorker({
    stream: options.stream ?? stream,
    createWorker: () => {
      starts++;
      if (options.createFails) throw new Error("create failed");
      return worker as unknown as Worker;
    },
    request: { csvData: new ArrayBuffer(0) } as ImportRequest,
    addWideEventContext: (context) => {
      contexts.push(context);
    },
    timeoutMs: 300_000,
    timers: {
      setTimeout: schedule,
      setInterval: schedule,
      clearTimeout: clear,
      clearInterval: clear,
    } as unknown as Pick<
      typeof globalThis,
      "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval"
    >,
  }).finally(() => {
    releases++;
  });
  const message = worker.onmessage;
  const error = worker.onerror;
  return {
    done,
    messages,
    posted,
    contexts,
    scheduled,
    send: (data: ImportWorkerMessage) => message?.({ data } as MessageEvent<ImportWorkerMessage>),
    crash: () => error?.({ message: "crash" } as ErrorEvent),
    abort: () => {
      stream.aborted = true;
      abort();
    },
    counts: () => ({ releases, terminations, starts }),
  };
}

test("progress ACK waits for the actual SSE write; heartbeats never ACK", async () => {
  const output = Promise.withResolvers<void>();
  const h = harness({ writeBlocked: output.promise });
  h.send({ type: "sse", data: "progress" });
  await Promise.resolve();
  expect(h.posted.filter((message) => message.type === "sse-ack")).toHaveLength(0);
  output.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(h.posted.filter((message) => message.type === "sse-ack")).toHaveLength(1);
  h.scheduled.get(2)!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(h.messages.at(-1)).toEqual({ data: "", event: "keepalive" });
  expect(h.posted.filter((message) => message.type === "sse-ack")).toHaveLength(1);
  h.send({ type: "done" });
  await h.done;
});

test.each(["done", "abort", "timeout", "crash"] as const)(
  "blocked progress never ACKs after %s cleanup",
  async (reason) => {
    const output = Promise.withResolvers<void>();
    const h = harness({ writeBlocked: output.promise });
    h.send({ type: "sse", data: "progress" });
    await Promise.resolve();
    if (reason === "done") h.send({ type: "done" });
    else if (reason === "abort") h.abort();
    else if (reason === "timeout") h.scheduled.get(1)!();
    else h.crash();
    output.resolve();
    await h.done;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.posted.filter((message) => message.type === "sse-ack")).toHaveLength(0);
    expect(h.counts().terminations).toBe(1);
  },
);

test("slow progress retains at most one heartbeat, then allows another after it drains", async () => {
  const output = Promise.withResolvers<void>();
  const h = harness({ writeBlocked: output.promise });
  h.send({ type: "sse", data: "progress" });
  const heartbeat = h.scheduled.get(2)!;
  for (let i = 0; i < 100; i++) heartbeat();
  await Promise.resolve();
  expect(h.messages).toEqual([{ data: "progress" }]);
  output.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(h.messages).toEqual([{ data: "progress" }, { data: "", event: "keepalive" }]);
  heartbeat();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(h.messages).toHaveLength(3);
  expect(h.posted.filter((message) => message.type === "sse-ack")).toHaveLength(1);
  h.send({ type: "done" });
  await h.done;
});

test("completion drains ordered SSE, releases once and ignores captured late callbacks", async () => {
  const h = harness();
  h.send({ type: "wide-event", context: { uploaded: 1 } });
  h.send({ type: "sse", data: '{"event":"import-complete"}' });
  h.send({ type: "done" });
  h.send({ type: "sse", data: "late" });
  h.send({ type: "wide-event", context: { late: true } });
  h.crash();
  h.abort();
  await h.done;
  expect(h.messages).toEqual([{ data: '{"event":"import-complete"}' }]);
  expect(h.contexts).toEqual([{ uploaded: 1 }]);
  expect(h.counts()).toEqual({ releases: 1, terminations: 1, starts: 1 });
  expect(h.scheduled.size).toBe(0);
});

test.each(["success-deadline", "error-deadline", "error-grace", "timeout-grace"] as const)(
  "real Hono %s settles blocked writes before late cancellation without draining",
  async (outcome) => {
    const ready = Promise.withResolvers<ReturnType<typeof harness>>();
    let startedWrites = 0;
    let settledWrites = 0;
    let transportAborted = false;
    const app = new Hono();
    app.get("/", (c) =>
      streamSSE(c, async (stream) => {
        const writeSSE = stream.writeSSE.bind(stream);
        stream.writeSSE = async (message) => {
          startedWrites++;
          try {
            await writeSSE(message);
          } finally {
            settledWrites++;
          }
        };
        stream.onAbort(() => {
          transportAborted = true;
        });
        const h = harness({ stream });
        ready.resolve(h);
        await h.done;
      }),
    );
    const response = await app.request("/");
    const h = await ready.promise;
    try {
      for (let i = 0; i < 5; i++) h.send({ type: "sse", data: "progress" });
      if (outcome === "success-deadline") h.send({ type: "done" });
      else if (outcome !== "timeout-grace") h.send({ type: "done", error: "failed" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(startedWrites).toBeGreaterThan(settledWrites);
      if (outcome === "timeout-grace") h.scheduled.get(1)!();
      h.scheduled.get(outcome.endsWith("grace") ? 3 : 1)!();
      await h.done;
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Do not read the response: abort must release the real Hono write itself.
      expect(transportAborted).toBe(true);
      expect(settledWrites).toBe(startedWrites);
      expect(h.counts()).toEqual({ releases: 1, terminations: 1, starts: 1 });
      expect(h.scheduled.size).toBe(0);
      await response.body!.cancel();
      expect(settledWrites).toBe(startedWrites);
    } finally {
      await response.body!.cancel();
    }
  },
);

test.each(["done-error", "crash", "timeout"])(
  "%s cleans up even when terminal SSE rejects",
  async (reason) => {
    const h = harness({ writeFails: true });
    if (reason === "done-error") h.send({ type: "done", error: "failed" });
    else if (reason === "crash") h.crash();
    else h.scheduled.get(1)!();
    await h.done;
    expect(JSON.parse(h.messages[0]!.data)).toMatchObject({
      event: "import-error",
      stage: "error",
    });
    expect(h.counts().releases).toBe(1);
    expect(h.counts().terminations).toBe(1);
    expect(h.scheduled.size).toBe(0);
    h.crash();
    h.send({ type: "done" });
    expect(h.counts().releases).toBe(1);
  },
);

test("client abort is not a timeout and emits no terminal error", async () => {
  const h = harness();
  const lateTimeout = h.scheduled.get(1)!;
  h.abort();
  lateTimeout();
  await h.done;
  expect(h.messages).toEqual([]);
  expect(h.counts().terminations).toBe(1);
  expect(h.scheduled.size).toBe(0);
});

test("timeout retains its terminal event contract and stops keepalives", async () => {
  const h = harness();
  const lateHeartbeat = h.scheduled.get(2)!;
  h.scheduled.get(1)!();
  // Worker cleanup is synchronous; route-owned metrics release when done resolves.
  expect(h.counts().terminations).toBe(1);
  lateHeartbeat();
  await h.done;
  expect(h.counts().releases).toBe(1);
  expect(h.counts().releases).toBe(1);
  expect(h.messages).toHaveLength(1);
  expect(JSON.parse(h.messages[0]!.data)).toEqual({
    event: "import-error",
    stage: "error",
    stageProgress: { message: "Import timed out after 5 minutes" },
    error: "Import timed out after 5 minutes",
  });
});

test.each(["postFails", "createFails"] as const)(
  "%s synchronous throw releases resources",
  async (failure) => {
    const h = harness({ [failure]: true });
    await h.done;
    expect(h.counts().releases).toBe(1);
    expect(h.counts().terminations).toBe(failure === "createFails" ? 0 : 1);
    expect(h.scheduled.size).toBe(0);
    expect(JSON.parse(h.messages[0]!.data).stage).toBe("error");
  },
);

test("already aborted stream never starts a worker", async () => {
  const h = harness({ aborted: true });
  await h.done;
  expect(h.counts()).toEqual({ releases: 1, terminations: 0, starts: 0 });
});

test.each(["progress", "heartbeat"])(
  "failed %s write finishes without waiting for timeout",
  async (source) => {
    const h = harness({ writeFails: true });
    if (source === "progress") h.send({ type: "sse", data: "progress" });
    else h.scheduled.get(2)!();
    await h.done;
    expect(h.counts().terminations).toBe(1);
    expect(h.counts().releases).toBe(1);
    expect(h.scheduled.size).toBe(0);
  },
);

test.each(["timeout", "abort"])("%s completes despite a blocked progress write", async (reason) => {
  const h = harness({ writeBlocked: new Promise(() => {}) });
  h.send({ type: "sse", data: "progress" });
  await Promise.resolve();
  if (reason === "timeout") h.scheduled.get(1)!();
  else h.abort();
  if (reason === "timeout") {
    expect(h.counts().terminations).toBe(1);
    h.scheduled.get(3)!(); // The timeout's own terminal-error drain is bounded too.
  }
  await h.done;
  expect(h.counts()).toEqual({ releases: 1, terminations: 1, starts: 1 });
  expect(h.scheduled.size).toBe(0);
});

test.each(["drain", "timeout", "abort"])(
  "successful worker waits for output unless interrupted: %s",
  async (outcome) => {
    const output = Promise.withResolvers<void>();
    const h = harness({ writeBlocked: output.promise });
    let completed = false;
    void h.done.then(() => {
      completed = true;
    });
    h.send({ type: "sse", data: "progress" });
    h.send({ type: "sse", data: '{"event":"import-complete"}' });
    h.send({ type: "done" });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(h.messages).toEqual([{ data: "progress" }]);
    if (outcome === "timeout") h.scheduled.get(1)!();
    else if (outcome === "abort") h.abort();
    else output.resolve();
    await h.done;
    expect(h.counts()).toEqual({ releases: 1, terminations: 1, starts: 1 });
    expect(h.scheduled.size).toBe(0);
    if (outcome === "drain") {
      expect(h.messages).toEqual([{ data: "progress" }, { data: '{"event":"import-complete"}' }]);
    }
    output.resolve();
  },
);

test.each(["abort", "deadline", "grace"])(
  "terminal-error drain releases blocked output on %s",
  async (interrupt) => {
    const h = harness({ writeBlocked: new Promise(() => {}) });
    let completed = false;
    void h.done.then(() => {
      completed = true;
    });
    h.send({ type: "sse", data: "progress" });
    h.send({ type: "done", error: "failed" });
    await Promise.resolve();
    expect(h.counts().terminations).toBe(1);
    expect(completed).toBe(false);
    expect(h.scheduled.has(2)).toBe(false); // Heartbeat stops immediately.
    if (interrupt === "abort") h.abort();
    else h.scheduled.get(interrupt === "deadline" ? 1 : 3)!();
    await h.done;
    expect(h.counts()).toEqual({ releases: 1, terminations: 1, starts: 1 });
    expect(h.scheduled.size).toBe(0);
  },
);

// Use Hono's actual writer and callback-owned close: a mock writeSSE records
// attempted messages even when returning from the route would discard them.
test.each(["done-error", "crash", "timeout", "postFails", "createFails", "success"] as const)(
  "real Hono SSE delivers terminal output before closing: %s",
  async (reason) => {
    const ready = Promise.withResolvers<ReturnType<typeof harness>>();
    const app = new Hono();
    app.get("/", (c) =>
      streamSSE(c, async (stream) => {
        const h = harness({
          stream,
          postFails: reason === "postFails",
          createFails: reason === "createFails",
        });
        ready.resolve(h);
        await h.done;
      }),
    );
    const response = await app.request("/");
    const h = await ready.promise;
    if (reason === "success") {
      h.send({ type: "sse", data: '{"event":"import-complete"}' });
      h.send({ type: "done" });
    } else if (reason === "done-error") h.send({ type: "done", error: "specific failure" });
    else if (reason === "crash") h.crash();
    else if (reason === "timeout") h.scheduled.get(1)!();
    const body = await response.text();
    const events = body
      .trim()
      .split("\n\n")
      .map((block) => JSON.parse(block.slice("data: ".length)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: reason === "success" ? "import-complete" : "import-error",
      ...(reason === "success" ? {} : { stage: "error" }),
      ...(reason === "done-error" ? { error: "specific failure" } : {}),
    });
    await h.done;
    expect(h.counts().releases).toBe(1);
    expect(h.scheduled.size).toBe(0);
  },
);

test("real Hono SSE drains progress before the terminal error", async () => {
  const ready = Promise.withResolvers<ReturnType<typeof harness>>();
  const app = new Hono();
  app.get("/", (c) =>
    streamSSE(c, async (stream) => {
      const h = harness({ stream });
      ready.resolve(h);
      await h.done;
    }),
  );
  const response = await app.request("/");
  const h = await ready.promise;
  h.send({ type: "sse", data: '{"event":"book-load"}' });
  h.send({ type: "sse", data: '{"event":"book-upload"}' });
  h.send({ type: "done", error: "specific failure" });
  const body = await response.text();
  expect(body.indexOf('"event":"book-load"')).toBeLessThan(body.indexOf('"event":"book-upload"'));
  expect(body.indexOf('"event":"book-upload"')).toBeLessThan(
    body.indexOf('"event":"import-error"'),
  );
  expect(body).toContain('"error":"specific failure"');
  await h.done;
  expect(h.scheduled.size).toBe(0);
});

test.each([
  ["success", "abort"],
  ["success", "deadline"],
  ["error", "abort"],
  ["error", "deadline"],
  ["error", "grace"],
] as const)("real Hono blocked %s drain is interrupted by %s", async (outcome, interrupt) => {
  const ready = Promise.withResolvers<ReturnType<typeof harness>>();
  const app = new Hono();
  app.get("/", (c) =>
    streamSSE(c, async (stream) => {
      const h = harness({ stream });
      ready.resolve(h);
      await h.done;
    }),
  );
  const response = await app.request("/");
  const h = await ready.promise;
  // Do not consume the response: enough progress fills Hono's prefetch buffer.
  for (let i = 0; i < 5; i++) h.send({ type: "sse", data: '{"event":"book-load"}' });
  if (outcome === "success") {
    h.send({ type: "sse", data: '{"event":"import-complete"}' });
    h.send({ type: "done" });
  } else h.send({ type: "done", error: "failed" });
  let completed = false;
  void h.done.then(() => {
    completed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(completed).toBe(false);
  expect(h.counts().terminations).toBe(1);
  if (interrupt === "abort") await response.body!.cancel();
  else h.scheduled.get(interrupt === "deadline" ? 1 : 3)!();
  await h.done;
  expect(h.counts().releases).toBe(1);
  expect(h.scheduled.size).toBe(0);
  if (interrupt !== "abort") {
    // Closing after interruption must not publish a queued success or error late.
    const body = await response.text();
    expect(body).not.toContain('"event":"import-complete"');
    expect(body).not.toContain('"event":"import-error"');
  }
});
