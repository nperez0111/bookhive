import { describe, expect, it } from "bun:test";
import {
  LOG_SHIPPING_LIMITS,
  LogShippingCredits,
  OpenObserveSender,
  responsePreview,
  type WorkerReply,
} from "./openObserve";

const options = {
  url: "https://logs.example/",
  organization: "bookhive",
  streamName: "server-logs",
  auth: { username: "test", password: "test" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("LogShippingCredits", () => {
  it("bounds bytes before posting to a stalled worker mailbox", () => {
    const credits = new LogShippingCredits();
    const line = "x".repeat(LOG_SHIPPING_LIMITS.lineBytes);
    for (let i = 0; i < 16; i++) expect(credits.admit(line)).not.toBeNull();
    for (let i = 0; i < 1_000; i++) expect(credits.admit(line)).toBeNull();
    expect(credits.stats().outstandingBytes).toBe(LOG_SHIPPING_LIMITS.bytes);
    expect(credits.stats().outstandingMessages).toBe(16);
    expect(credits.stats().droppedMessages).toBe(1_000);
    credits.acknowledge({ type: "ack", ids: [0], result: "sent" });
    expect(credits.admit(line)).not.toBeNull();
    expect(credits.stats().outstandingBytes).toBe(LOG_SHIPPING_LIMITS.bytes);
  });

  it("bounds tiny-message overhead, rejects oversized lines and counts UTF-8 bytes", () => {
    const credits = new LogShippingCredits();
    expect(credits.admit("é")?.id).toBe(0);
    expect(credits.stats().outstandingBytes).toBe(2);
    expect(credits.admit("x".repeat(LOG_SHIPPING_LIMITS.lineBytes + 1))).toBeNull();
    for (let i = 1; i < LOG_SHIPPING_LIMITS.messages; i++) credits.admit("");
    expect(credits.admit("")).toBeNull();
    expect(credits.stats().outstandingMessages).toBe(LOG_SHIPPING_LIMITS.messages);
  });

  it("ignores duplicate ACKs and stops admitting after disable or close", () => {
    const credits = new LogShippingCredits();
    const message = credits.admit("{}");
    expect(message).not.toBeNull();
    credits.acknowledge({ type: "ack", ids: [message!.id, message!.id], result: "failed" });
    expect(credits.stats().failedMessages).toBe(1);
    credits.admit("{}");
    credits.disable();
    expect(credits.admit("{}")).toBeNull();
    expect(credits.stats().outstandingMessages).toBe(1);
    credits.closed();
    expect(credits.stats().outstandingBytes).toBe(0);
    expect(credits.stats().droppedMessages).toBe(2);
  });
});

describe("OpenObserveSender", () => {
  it("flushes overdue partial backlog immediately after the active request settles", async () => {
    let now = 0;
    const gate = deferred<Response>();
    const bodies: string[] = [];
    const sender = new OpenObserveSender(options, {
      reply: () => {},
      log: () => {},
      now: () => now,
      fetch: (_url, init) => {
        if (typeof init.body !== "string") throw new Error("Expected a string batch");
        bodies.push(init.body);
        return bodies.length === 1 ? gate.promise : Promise.resolve(new Response());
      },
    });
    try {
      sender.enqueue({ type: "log", id: 0, data: "{}" });
      const flushing = sender.flush();
      now = 100;
      sender.enqueue({ type: "log", id: 1, data: '{"queued":true}' });
      now = 4_900;
      sender.enqueue({ type: "log", id: 2, data: '{"later":true}' });
      now = 5_100;
      gate.resolve(new Response());
      await flushing;
      expect(bodies.map((body) => JSON.parse(body))).toEqual([
        [{}],
        [{ queued: true }, { later: true }],
      ]);
      await Bun.sleep(0);
    } finally {
      sender.close();
    }
  });

  it("HTTP and non-refusal failures each break the refusal streak", async () => {
    const replies: WorkerReply[] = [];
    const outcomes = ["refused", "refused", "http", "refused", "refused", "other", "refused"];
    let index = 0;
    const sender = new OpenObserveSender(options, {
      reply: (reply) => {
        replies.push(reply);
      },
      log: () => {},
      fetch: () => {
        const outcome = outcomes[index++];
        if (outcome === "http") return Promise.resolve(new Response(null, { status: 503 }));
        return Promise.reject(
          Object.assign(new Error(outcome), {
            code: outcome === "refused" ? "ConnectionRefused" : "ETIMEDOUT",
          }),
        );
      },
    });
    try {
      for (let id = 0; id < outcomes.length; id++) {
        sender.enqueue({ type: "log", id, data: "{}" });
        await sender.flush();
      }
      expect(replies.filter((reply) => reply.type === "disabled")).toHaveLength(0);
      expect(replies).toHaveLength(outcomes.length);
      expect(index).toBe(outcomes.length);
    } finally {
      sender.close();
    }
  });

  it("coalesces overflow-only diagnostics without waiting for a batch settlement", async () => {
    const diagnostics: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const sender = new OpenObserveSender(options, {
      reply: () => {},
      log: (_level, message, fields) => {
        diagnostics.push({ message, fields });
      },
      fetch: () => {
        throw new Error("Oversized entries must not be sent");
      },
    });
    try {
      const data = "x".repeat(LOG_SHIPPING_LIMITS.lineBytes + 1);
      for (let id = 0; id < 3; id++) sender.enqueue({ type: "log", id, data });
      expect(diagnostics).toHaveLength(0);
      await Bun.sleep(LOG_SHIPPING_LIMITS.flushMs + 50);
      expect(diagnostics).toEqual([
        {
          message: "openobserve_dropped",
          fields: { droppedMessages: 3, droppedBytes: data.length * 3 },
        },
      ]);
      sender.close();
      sender.enqueue({ type: "log", id: 3, data });
      expect(diagnostics).toHaveLength(1);
    } finally {
      sender.close();
    }
  }, 10_000);

  it("holds credits through actual HTTP settlement, including abort-ignoring work", async () => {
    const gate = deferred<Response>();
    const credits = new LogShippingCredits();
    const replies: WorkerReply[] = [];
    let signal: AbortSignal | undefined;
    const sender = new OpenObserveSender(options, {
      reply: (reply) => {
        replies.push(reply);
        if (reply.type === "ack") credits.acknowledge(reply);
      },
      log: () => {},
      fetch: (_url, init) => {
        signal = init.signal!;
        return gate.promise;
      },
    });
    sender.enqueue(credits.admit('{"level":30}\n')!);
    const flushing = sender.flush();
    sender.close();
    expect(signal?.aborted).toBe(true);
    expect(replies).toHaveLength(0);
    expect(credits.stats().outstandingMessages).toBe(1);
    gate.resolve(new Response(null, { status: 200 }));
    await flushing;
    expect(credits.stats().outstandingMessages).toBe(0);
    expect(credits.stats().sentMessages).toBe(1);
  });

  it("bounds the worker queue independently while a batch is in flight", async () => {
    const gate = deferred<Response>();
    const replies: WorkerReply[] = [];
    const sender = new OpenObserveSender(options, {
      reply: (reply) => {
        replies.push(reply);
      },
      log: () => {},
      fetch: () => gate.promise,
    });
    const data = "x".repeat(LOG_SHIPPING_LIMITS.lineBytes);
    sender.enqueue({ type: "log", id: 0, data });
    const flushing = sender.flush();
    for (let id = 1; id <= 16; id++) sender.enqueue({ type: "log", id, data });
    expect(replies).toEqual([{ type: "ack", ids: [16], result: "dropped" }]);
    sender.close();
    expect(replies[1]).toEqual({
      type: "ack",
      ids: Array.from({ length: 15 }, (_, i) => i + 1),
      result: "dropped",
    });
    gate.resolve(new Response());
    await flushing;
    expect(replies[2]).toEqual({ type: "ack", ids: [0], result: "sent" });
  });

  it("retains ownership until response-body cancellation settles", async () => {
    const cancelled = deferred<void>();
    const replies: WorkerReply[] = [];
    const sender = new OpenObserveSender(options, {
      reply: (reply) => {
        replies.push(reply);
      },
      log: () => {},
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              cancel: () => cancelled.promise,
            }),
          ),
        ),
    });
    sender.enqueue({ type: "log", id: 0, data: "{}" });
    const flushing = sender.flush();
    await Bun.sleep(0);
    expect(replies).toHaveLength(0);
    sender.close();
    expect(replies).toHaveLength(0);
    cancelled.resolve();
    await flushing;
    expect(replies).toEqual([{ type: "ack", ids: [0], result: "sent" }]);
  });

  it("sends valid batches and drops failed sends without retry retention", async () => {
    const credits = new LogShippingCredits();
    const bodies: string[] = [];
    const diagnostics: unknown[] = [];
    const sender = new OpenObserveSender(options, {
      reply: (reply) => {
        if (reply.type === "ack") credits.acknowledge(reply);
      },
      log: (_level, _message, fields) => {
        diagnostics.push(fields);
      },
      fetch: (_url, init) => {
        if (typeof init.body !== "string") throw new Error("Expected a string batch");
        bodies.push(init.body);
        return Promise.resolve(
          new Response("x".repeat(10_000), { status: 503, statusText: "Service Unavailable" }),
        );
      },
    });
    sender.enqueue(credits.admit('{"a":1}\n')!);
    sender.enqueue(credits.admit('{"a":2}\n')!);
    await sender.flush();
    expect(JSON.parse(bodies[0]!)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(diagnostics).toEqual([
      { status: 503, statusText: "Service Unavailable", body: "x".repeat(500) },
    ]);
    expect(credits.stats().failedMessages).toBe(2);
    expect(credits.stats().outstandingBytes).toBe(0);
    sender.close();
  });

  it("disables after refused connections and releases pending queued lines", async () => {
    const replies: WorkerReply[] = [];
    const sender = new OpenObserveSender(options, {
      reply: (reply) => {
        replies.push(reply);
      },
      log: () => {},
      fetch: () =>
        Promise.reject(Object.assign(new Error("refused"), { code: "ConnectionRefused" })),
    });
    for (let id = 0; id < 3; id++) {
      sender.enqueue({ type: "log", id, data: "{}" });
      const flushing = sender.flush();
      if (id === 2) sender.enqueue({ type: "log", id: 999, data: "{}" });
      await flushing;
    }
    expect(replies).toContainEqual({ type: "disabled" });
    expect(replies).toContainEqual({ type: "ack", ids: [999], result: "dropped" });
    sender.enqueue({ type: "log", id: 3, data: "{}" });
    expect(replies.at(-1)).toEqual({ type: "ack", ids: [3], result: "dropped" });
    sender.close();
  });
});

it("reads only a bounded error prefix and cancels an unending response", async () => {
  let cancelled = false;
  let pulls = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1_024).fill(97));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  expect(await responsePreview(response)).toBe("a".repeat(500));
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThanOrEqual(2);
});

it("ships and acknowledges a real worker batch", async () => {
  let received: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received = await request.json();
      return new Response(null, { status: 200 });
    },
  });
  const worker = new Worker(new URL("../workers/open-observe-worker.ts", import.meta.url).href);
  const ack = deferred<WorkerReply>();
  worker.onmessage = (event: MessageEvent<WorkerReply>) => ack.resolve(event.data);
  const timeout = setTimeout(() => ack.resolve({ type: "disabled" }), 2_000);
  try {
    worker.postMessage({ type: "init", options: { ...options, url: server.url.origin } });
    for (let id = 0; id < LOG_SHIPPING_LIMITS.batchSize; id++) {
      worker.postMessage({ type: "log", id, data: JSON.stringify({ id }) });
    }
    expect(await ack.promise).toEqual({
      type: "ack",
      ids: Array.from({ length: LOG_SHIPPING_LIMITS.batchSize }, (_, id) => id),
      result: "sent",
    });
    expect(received).toEqual(
      Array.from({ length: LOG_SHIPPING_LIMITS.batchSize }, (_, id) => ({ id })),
    );
  } finally {
    clearTimeout(timeout);
    worker.terminate();
    await server.stop(true);
  }
});

it("preserves stdout when remote lines are shed and after logger shutdown", async () => {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { getLogger, getLogShippingStats, destroyLogger } from ${JSON.stringify(moduleUrl)};
    const logger = getLogger({ name: "shipping-test" });
    logger.info({ marker: "oversize", payload: "x".repeat(70_000) });
    destroyLogger();
    logger.info({ marker: "after-shutdown" });
    console.log(JSON.stringify({ marker: "stats", stats: getLogShippingStats() }));
  `,
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DB_PATH: ":memory:",
        KV_DB_PATH: ":memory:",
        COOKIE_SECRET: "00000000000000000000000000000000",
        OPEN_OBSERVE_URL: "http://127.0.0.1:9",
        OPEN_OBSERVE_USER: "test",
        OPEN_OBSERVE_PASSWORD: "test",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [output, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const lines = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines.find((line) => line.marker === "oversize")?.payload).toHaveLength(70_000);
  expect(lines.some((line) => line.marker === "after-shutdown")).toBe(true);
  expect(lines.find((line) => line.marker === "stats")?.stats.droppedMessages).toBe(2);
});
