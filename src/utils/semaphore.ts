/**
 * Async concurrency limiter.
 *
 * Extracted from the hand-rolled backfill limiter in `src/bsky/ingester.ts` so
 * there is one implementation. Used to bound anything that spawns Workers or
 * makes outbound requests — an unbounded fan-out of WAF solves is what grew
 * worker heaps to ~2 GB and triggered the 2026-08-01 OOM storm.
 *
 * `maxPending` / `acquireTimeoutMs` exist so a saturated limiter sheds load
 * instead of accumulating an unbounded queue of waiters (each holding its
 * closure state alive).
 */

export class SemaphoreFullError extends Error {
  constructor(label: string) {
    super(`${label} queue is full`);
    this.name = "SemaphoreFullError";
  }
}

export class SemaphoreTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out waiting ${ms}ms for a slot`);
    this.name = "SemaphoreTimeoutError";
  }
}

export type SemaphoreOptions = {
  /** Name used in error messages. */
  label?: string;
  /** Throw SemaphoreFullError instead of queueing once this many callers wait. */
  maxPending?: number;
  /** Throw SemaphoreTimeoutError if a caller waits longer than this for a slot. */
  acquireTimeoutMs?: number;
  /** Invoked whenever active/pending change — for metrics gauges. */
  onChange?: (state: { active: number; pending: number }) => void;
};

type Waiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

export class Semaphore {
  readonly limit: number;
  private readonly label: string;
  private readonly maxPending: number;
  private readonly acquireTimeoutMs: number;
  private readonly onChange: ((state: { active: number; pending: number }) => void) | undefined;
  private activeCount = 0;
  private waiters: Waiter[] = [];

  constructor(limit: number, options: SemaphoreOptions = {}) {
    this.limit = Math.max(1, limit);
    this.label = options.label ?? "semaphore";
    this.maxPending = options.maxPending ?? Infinity;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 0;
    this.onChange = options.onChange;
  }

  get active(): number {
    return this.activeCount;
  }

  get pending(): number {
    return this.waiters.length;
  }

  /**
   * Reject everything still waiting for a slot (shutdown). Work already running
   * is left alone — callers own their own cancellation.
   */
  clearPending(reason = "semaphore cleared"): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.notify();
  }

  /** Acquire a slot, run `fn`, release in `finally`. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount++;
      this.notify();
      return Promise.resolve();
    }

    if (this.waiters.length >= this.maxPending) {
      return Promise.reject(new SemaphoreFullError(this.label));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: null };
      if (this.acquireTimeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) this.waiters.splice(index, 1);
          this.notify();
          reject(new SemaphoreTimeoutError(this.label, this.acquireTimeoutMs));
        }, this.acquireTimeoutMs);
      }
      this.waiters.push(waiter);
      this.notify();
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot straight over — activeCount stays as-is.
      if (next.timer) clearTimeout(next.timer);
      this.notify();
      next.resolve();
      return;
    }
    this.activeCount--;
    this.notify();
  }

  private notify(): void {
    this.onChange?.({ active: this.activeCount, pending: this.waiters.length });
  }
}

/**
 * Reject with `${label} timed out after ${ms}ms` if `promise` hasn't settled.
 * The timer is always cleared, so a resolved promise doesn't hold the event
 * loop open.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
