import { errorMessage } from "../lib/errors";

// Per logger isolate. These are payload-byte budgets, not an estimate of native/JS heap bytes.
export const LOG_SHIPPING_LIMITS = {
  bytes: 1_048_576,
  messages: 1_024,
  lineBytes: 65_536,
  batchSize: 100,
  flushMs: 5_000,
} as const;

export interface OpenObserveOptions {
  url: string;
  organization: string;
  streamName: string;
  auth: { username: string; password: string };
}

export type LogMessage = { type: "log"; id: number; data: string };
export type AckMessage = { type: "ack"; ids: number[]; result: "sent" | "failed" | "dropped" };
export type WorkerReply = AckMessage | { type: "disabled" };

/** Credits include the worker mailbox, queued lines AND the HTTP batch until it settles. */
export class LogShippingCredits {
  private readonly outstanding = new Map<number, number>();
  private bytes = 0;
  private nextId = 0;
  private available = true;
  private droppedMessages = 0;
  private droppedBytes = 0;
  private failedMessages = 0;
  private sentMessages = 0;

  admit(data: string): LogMessage | null {
    const bytes = Buffer.byteLength(data);
    if (
      !this.available ||
      bytes > LOG_SHIPPING_LIMITS.lineBytes ||
      this.bytes + bytes > LOG_SHIPPING_LIMITS.bytes ||
      this.outstanding.size >= LOG_SHIPPING_LIMITS.messages
    ) {
      this.droppedMessages++;
      this.droppedBytes += bytes;
      return null;
    }
    const id = this.nextId++;
    this.outstanding.set(id, bytes);
    this.bytes += bytes;
    return { type: "log", id, data };
  }

  acknowledge(message: AckMessage): void {
    for (const id of message.ids) {
      const bytes = this.outstanding.get(id);
      if (bytes === undefined) continue;
      this.outstanding.delete(id);
      this.bytes -= bytes;
      if (message.result === "sent") this.sentMessages++;
      else if (message.result === "failed") this.failedMessages++;
      else {
        this.droppedMessages++;
        this.droppedBytes += bytes;
      }
    }
  }

  disable(): void {
    this.available = false;
  }

  /** Only after the worker has actually closed (or a postMessage failed). */
  closed(): void {
    this.disable();
    this.acknowledge({ type: "ack", ids: [...this.outstanding.keys()], result: "dropped" });
  }

  stats() {
    return {
      available: this.available,
      outstandingBytes: this.bytes,
      outstandingMessages: this.outstanding.size,
      maxBytes: LOG_SHIPPING_LIMITS.bytes,
      maxMessages: LOG_SHIPPING_LIMITS.messages,
      droppedMessages: this.droppedMessages,
      droppedBytes: this.droppedBytes,
      sentMessages: this.sentMessages,
      failedMessages: this.failedMessages,
    };
  }
}

/** Read a bounded diagnostic prefix, then release the rest of the response body. */
export async function responsePreview(response: Response, maxBytes = 500): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const prefix = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, maxBytes - length);
      prefix.set(value.subarray(0, take), length);
      length += take;
    }
    return new TextDecoder().decode(prefix.subarray(0, length));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type ShippingDependencies = {
  reply: (message: WorkerReply) => void;
  log: (level: number, message: string, fields: Record<string, unknown>) => void;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
};

export class OpenObserveSender {
  private readonly queue: Array<LogMessage & { bytes: number; at: number }> = [];
  private queuedBytes = 0;
  private inFlightBytes = 0;
  private inFlightMessages = 0;
  private sending = false;
  private disabled = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dropTimer: ReturnType<typeof setTimeout> | undefined;
  private droppedMessages = 0;
  private droppedBytes = 0;
  private reportedDrops = 0;
  private controller: AbortController | undefined;
  private readonly apiUrl: string;
  private readonly authHeader: string;

  constructor(
    options: OpenObserveOptions,
    private readonly deps: ShippingDependencies,
  ) {
    this.apiUrl = `${options.url.replace(/\/+$/, "")}/api/${encodeURIComponent(options.organization)}/${encodeURIComponent(options.streamName)}/_json`;
    this.authHeader = `Basic ${Buffer.from(`${options.auth.username}:${options.auth.password}`).toString("base64")}`;
  }

  enqueue(message: LogMessage): void {
    const bytes = Buffer.byteLength(message.data);
    if (
      this.disabled ||
      bytes > LOG_SHIPPING_LIMITS.lineBytes ||
      this.queuedBytes + this.inFlightBytes + bytes > LOG_SHIPPING_LIMITS.bytes ||
      this.queue.length + this.inFlightMessages >= LOG_SHIPPING_LIMITS.messages
    ) {
      this.deps.reply({ type: "ack", ids: [message.id], result: "dropped" });
      this.droppedMessages++;
      this.droppedBytes += bytes;
      // Coalesce overflow-only traffic too; it may never produce a batch settlement.
      if (!this.disabled)
        this.dropTimer ??= setTimeout(() => this.reportDrops(), LOG_SHIPPING_LIMITS.flushMs);
      return;
    }
    this.queue.push({ ...message, data: message.data.trimEnd(), bytes, at: this.now() });
    this.queuedBytes += bytes;
    this.schedule();
  }

  private schedule(): void {
    if (this.disabled || this.sending || !this.queue.length) return;
    const delay = Math.max(0, this.queue[0]!.at + LOG_SHIPPING_LIMITS.flushMs - this.now());
    if (this.queue.length >= LOG_SHIPPING_LIMITS.batchSize || delay === 0) void this.flush();
    else
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, delay);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private reportDrops(): void {
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.dropTimer = undefined;
    if (this.droppedMessages === this.reportedDrops) return;
    this.reportedDrops = this.droppedMessages;
    this.deps.log(40, "openobserve_dropped", {
      droppedMessages: this.droppedMessages,
      droppedBytes: this.droppedBytes,
    });
  }

  async flush(): Promise<void> {
    if (this.disabled || this.sending || !this.queue.length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.sending = true;
    const batch = this.queue.splice(0, LOG_SHIPPING_LIMITS.batchSize);
    this.inFlightBytes = batch.reduce((sum, line) => sum + line.bytes, 0);
    this.inFlightMessages = batch.length;
    this.queuedBytes -= this.inFlightBytes;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let result: AckMessage["result"] = "failed";
    try {
      const response = await (this.deps.fetch ?? globalThis.fetch)(this.apiUrl, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
        body: `[${batch.map((line) => line.data).join(",")}]`,
      });
      // Every HTTP response breaks a consecutive connection-refusal streak.
      this.failures = 0;
      if (response.ok) {
        await response.body?.cancel();
        result = "sent";
      } else {
        this.deps.log(50, "openobserve_send_failed", {
          status: response.status,
          statusText: response.statusText,
          body: await responsePreview(response).catch(() => ""),
        });
      }
    } catch (error) {
      if (!this.disabled) {
        const cause = error as { code?: string; cause?: { code?: string }; message?: string };
        const code = cause?.cause?.code ?? cause?.code;
        if (
          code === "ConnectionRefused" ||
          code === "ECONNREFUSED" ||
          /unable to connect/i.test(cause?.message ?? "")
        ) {
          this.deps.log(50, "openobserve_send_failed", {
            error: errorMessage(error).slice(0, 500),
            refused: true,
          });
          if (++this.failures >= 3) {
            this.close();
            this.deps.reply({ type: "disabled" });
            this.deps.log(40, "openobserve_disabled", {
              reason: "connection refused",
              failures: this.failures,
              recovery: "worker restart",
            });
          }
        } else {
          this.failures = 0;
          this.deps.log(50, "openobserve_send_failed", {
            error: errorMessage(error).slice(0, 500),
          });
        }
      }
    } finally {
      clearTimeout(timeout);
      this.controller = undefined;
      this.inFlightBytes = 0;
      this.inFlightMessages = 0;
      this.sending = false;
      this.deps.reply({ type: "ack", ids: batch.map((line) => line.id), result });
      this.reportDrops();
      this.schedule();
    }
  }

  close(): void {
    this.disabled = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    if (this.queue.length) {
      this.droppedMessages += this.queue.length;
      this.droppedBytes += this.queuedBytes;
      this.deps.reply({ type: "ack", ids: this.queue.map((line) => line.id), result: "dropped" });
      this.queue.length = 0;
      this.queuedBytes = 0;
    }
    this.reportDrops();
    // In-flight credits remain owned until the actual fetch/body cancellation settles.
  }
}
