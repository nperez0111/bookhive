import { describe, expect, test } from "bun:test";
import { OpenObserveBuffer } from "./openObserveBuffer";

function harness(overrides: Partial<ConstructorParameters<typeof OpenObserveBuffer>[0]> = {}) {
  let now = 0;
  const timers = new Map<() => void, number>();
  const batches: string[][] = [];
  const buffer = new OpenObserveBuffer({
    batchSize: 3,
    flushMs: 100,
    maxEntries: 5,
    maxBytes: 20,
    now: () => now,
    schedule(callback, delay) {
      timers.set(callback, now + delay);
      return () => {
        timers.delete(callback);
      };
    },
    async send(lines) {
      batches.push(lines);
      return "success";
    },
    ...overrides,
  });
  return {
    buffer,
    batches,
    timers,
    advance(time: number) {
      now = time;
      for (const [callback, deadline] of timers) {
        if (deadline <= now) {
          timers.delete(callback);
          callback();
        }
      }
    },
  };
}

describe("OpenObserve best-effort buffer", () => {
  test("steady arrivals cannot debounce the oldest entry's deadline", async () => {
    const h = harness({ batchSize: 10 });
    h.buffer.enqueue("a");
    h.advance(90);
    h.buffer.enqueue("b");
    expect([...h.timers.values()]).toEqual([100]);
    h.advance(100);
    await Promise.resolve();
    expect(h.batches).toEqual([["a", "b"]]);
    expect(h.buffer.stats.entries).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  test("entry and UTF-8 byte caps include in-flight entries and drop newest", async () => {
    let finish!: (result: "success") => void;
    const h = harness({
      batchSize: 2,
      maxEntries: 3,
      maxBytes: 8,
      send: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    h.buffer.enqueue("é");
    h.buffer.enqueue("é");
    h.buffer.enqueue("abcdX"); // byte cap, despite remaining entry capacity
    h.buffer.enqueue("ab");
    h.buffer.enqueue("a"); // entry cap, despite remaining byte capacity
    expect(h.buffer.stats).toMatchObject({ entries: 3, bytes: 6, dropped: { capacity: 2 } });
    finish("success");
    await Promise.resolve();
    expect(h.buffer.stats).toMatchObject({ entries: 1, bytes: 2 });
  });

  test("a single oversized entry is not retained or scheduled", () => {
    const h = harness({ maxBytes: 3 });
    h.buffer.enqueue("éé");
    expect(h.buffer.stats).toMatchObject({ entries: 0, bytes: 0, dropped: { capacity: 1 } });
    expect(h.timers.size).toBe(0);
  });

  test("overdue partial backlog flushes immediately after an in-flight send", async () => {
    let finish!: (result: "success") => void;
    const batches: string[][] = [];
    const h = harness({
      batchSize: 2,
      send(lines) {
        batches.push(lines);
        if (batches.length === 1)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return Promise.resolve("success");
      },
    });
    h.buffer.enqueue("a");
    h.buffer.enqueue("b");
    h.advance(20);
    h.buffer.enqueue("c");
    h.advance(200);
    expect(batches).toEqual([["a", "b"]]);
    finish("success");
    await Promise.resolve();
    await Promise.resolve();
    expect(batches).toEqual([["a", "b"], ["c"]]);
    expect(h.buffer.stats.entries).toBe(0);
  });

  test("successful sends reset consecutive connection refusals", async () => {
    const outcomes = ["refused", "refused", "success", "refused", "refused"] as const;
    let index = 0;
    const h = harness({ batchSize: 1, send: async () => outcomes[index++]! });
    for (let i = 0; i < outcomes.length; i++) {
      h.buffer.enqueue("a");
      await Promise.resolve();
    }
    expect(h.buffer.stats).toMatchObject({ failures: 2, disabled: false, dropped: { failed: 4 } });
  });

  test("HTTP/other failures break a refusal streak and failed entries are not replayed", async () => {
    const outcomes = ["refused", "refused", "failed", "refused"] as const;
    let index = 0;
    const h = harness({ batchSize: 1, send: async () => outcomes[index++]! });
    for (let i = 0; i < outcomes.length; i++) {
      h.buffer.enqueue("a");
      await Promise.resolve();
    }
    expect(index).toBe(4);
    expect(h.buffer.stats).toMatchObject({
      entries: 0,
      failures: 1,
      disabled: false,
      dropped: { failed: 4 },
    });
    expect(h.timers.size).toBe(0);
  });

  test("third consecutive refusal disables, clears backlog, and ignores future shipping", async () => {
    let finish!: (result: "refused") => void;
    let sends = 0;
    const h = harness({
      batchSize: 1,
      send: () => {
        sends++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    for (let i = 0; i < 2; i++) {
      h.buffer.enqueue("a");
      finish("refused");
      await Promise.resolve();
    }
    h.buffer.enqueue("a");
    h.buffer.enqueue("queued");
    finish("refused");
    await Promise.resolve();
    expect(h.buffer.stats).toMatchObject({
      entries: 0,
      bytes: 0,
      failures: 3,
      disabled: true,
      dropped: { failed: 3, disabled: 1 },
    });
    h.buffer.enqueue("later");
    h.advance(1000);
    expect(h.buffer.stats.dropped.disabled).toBe(2);
    expect(sends).toBe(3);
    expect(h.timers.size).toBe(0);
    // Worker restart creates a fresh buffer rather than replaying stale logs.
    const recovered = harness({ batchSize: 1 });
    recovered.buffer.enqueue("fresh");
    await Promise.resolve();
    expect(recovered.batches).toEqual([["fresh"]]);
  });

  test("unexpected transport throws still release retained memory", async () => {
    const h = harness({
      batchSize: 1,
      send: async () => {
        throw new Error("transport");
      },
    });
    h.buffer.enqueue("a");
    await Promise.resolve();
    expect(h.buffer.stats).toMatchObject({ entries: 0, bytes: 0, dropped: { failed: 1 } });
  });
});
