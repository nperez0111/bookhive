import { describe, it, expect } from "bun:test";

import { Semaphore, SemaphoreFullError, SemaphoreTimeoutError, withTimeout } from "./semaphore";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Semaphore", () => {
  it("never runs more than `limit` tasks at once", async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let peak = 0;

    const gates = Array.from({ length: 5 }, () => deferred());
    const runs = gates.map((gate) =>
      sem.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await gate.promise;
        concurrent--;
      }),
    );

    await Bun.sleep(1);
    expect(sem.active).toBe(2);
    expect(sem.pending).toBe(3);

    for (const gate of gates) gate.resolve();
    await Promise.all(runs);

    expect(peak).toBe(2);
    expect(sem.active).toBe(0);
    expect(sem.pending).toBe(0);
  });

  it("releases the slot when the task throws", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(sem.active).toBe(0);
    await expect(sem.run(async () => "ok")).resolves.toBe("ok");
  });

  it("sheds load past maxPending instead of queueing forever", async () => {
    const sem = new Semaphore(1, { label: "test", maxPending: 1 });
    const gate = deferred();

    const running = sem.run(() => gate.promise);
    const queued = sem.run(async () => "queued");
    await expect(sem.run(async () => "rejected")).rejects.toBeInstanceOf(SemaphoreFullError);

    gate.resolve();
    await running;
    await expect(queued).resolves.toBe("queued");
  });

  it("times out a caller that waits too long for a slot", async () => {
    const sem = new Semaphore(1, { label: "test", acquireTimeoutMs: 10 });
    const gate = deferred();
    const running = sem.run(() => gate.promise);

    await expect(sem.run(async () => "never")).rejects.toBeInstanceOf(SemaphoreTimeoutError);
    expect(sem.pending).toBe(0);

    gate.resolve();
    await running;
  });

  it("reports active/pending through onChange", async () => {
    const seen: Array<{ active: number; pending: number }> = [];
    const sem = new Semaphore(1, { onChange: (state) => seen.push({ ...state }) });
    const gate = deferred();
    const running = sem.run(() => gate.promise);
    const queued = sem.run(async () => {});

    expect(seen.some((s) => s.active === 1 && s.pending === 1)).toBe(true);

    gate.resolve();
    await Promise.all([running, queued]);
    expect(seen.at(-1)).toEqual({ active: 0, pending: 0 });
  });

  it("acquireSlot holds the slot until released, and ignores double release", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquireSlot();
    expect(sem.active).toBe(1);

    // A second caller must wait — this is what stops a timed-out enrichment
    // from letting an extra scrape run while the first is still in flight.
    let ran = false;
    const queued = sem.run(async () => {
      ran = true;
    });
    await Bun.sleep(1);
    expect(ran).toBe(false);

    release();
    release(); // no-op
    await queued;
    expect(ran).toBe(true);
    expect(sem.active).toBe(0);
  });

  it("rejects waiters on clearPending", async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    const running = sem.run(() => gate.promise);
    const queued = sem.run(async () => "never");

    sem.clearPending("shutting down");
    await expect(queued).rejects.toThrow("shutting down");

    gate.resolve();
    await running;
  });
});

describe("withTimeout", () => {
  it("passes through a fast result", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "task")).resolves.toBe("ok");
  });

  it("rejects with the label when the deadline passes", async () => {
    await expect(withTimeout(Bun.sleep(50), 5, "slow task")).rejects.toThrow(
      "slow task timed out after 5ms",
    );
  });
});
