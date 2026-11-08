type SendResult = "success" | "failed" | "refused";

interface Entry {
  line: string;
  bytes: number;
  at: number;
}

interface BufferOptions {
  batchSize: number;
  flushMs: number;
  maxEntries: number;
  maxBytes: number;
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
  send: (lines: string[]) => Promise<SendResult>;
  onSettled?: () => void;
}

/** Best-effort shipping only: failed/overflow/disabled entries are never replayed. */
export class OpenObserveBuffer {
  private queue: Entry[] = [];
  private inFlight: Entry[] = [];
  private bytes = 0;
  private cancelTimer: (() => void) | undefined;
  private failures = 0;
  private disabled = false;
  private dropped = { capacity: 0, failed: 0, disabled: 0 };

  constructor(private readonly options: BufferOptions) {}

  get stats() {
    return {
      entries: this.queue.length + this.inFlight.length,
      bytes: this.bytes,
      failures: this.failures,
      disabled: this.disabled,
      dropped: { ...this.dropped },
    };
  }

  enqueue(line: string) {
    if (this.disabled) {
      this.dropped.disabled++;
      return;
    }
    const bytes = Buffer.byteLength(line, "utf8");
    if (
      this.queue.length + this.inFlight.length >= this.options.maxEntries ||
      this.bytes + bytes > this.options.maxBytes
    ) {
      this.dropped.capacity++;
      return;
    }
    this.queue.push({ line, bytes, at: this.options.now() });
    this.bytes += bytes;
    this.schedule();
  }

  private disable() {
    this.disabled = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.dropped.disabled += this.queue.length;
    this.bytes -= this.queue.reduce((sum, entry) => sum + entry.bytes, 0);
    this.queue = [];
  }

  private schedule() {
    if (this.disabled || this.inFlight.length || !this.queue.length) return;
    const delay =
      this.queue.length >= this.options.batchSize
        ? 0
        : Math.max(0, this.queue[0]!.at + this.options.flushMs - this.options.now());
    if (delay === 0) {
      this.cancelTimer?.();
      this.cancelTimer = undefined;
      void this.flush();
    } else if (!this.cancelTimer) {
      // Never debounce: subsequent arrivals cannot postpone the oldest entry.
      this.cancelTimer = this.options.schedule(() => {
        this.cancelTimer = undefined;
        void this.flush();
      }, delay);
    }
  }

  private async flush() {
    this.inFlight = this.queue.splice(0, this.options.batchSize);
    let result: SendResult = "failed";
    try {
      result = await this.options.send(this.inFlight.map((entry) => entry.line));
    } catch {
      // A throwing transport still releases the batch; there is no retry queue.
    } finally {
      if (result !== "success") this.dropped.failed += this.inFlight.length;
      this.bytes -= this.inFlight.reduce((sum, entry) => sum + entry.bytes, 0);
      this.inFlight = [];
      this.failures = result === "refused" ? this.failures + 1 : 0;
      if (this.failures >= 3) this.disable();
      this.options.onSettled?.();
      // Overdue pending entries flush immediately, including a partial batch.
      this.schedule();
    }
  }
}
