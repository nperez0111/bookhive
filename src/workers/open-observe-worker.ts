/**
 * Bun worker thread that receives JSON log lines from the main thread,
 * batches them, and sends to OpenObserve via HTTP.
 *
 * Protocol:
 *   main → worker: { type: "init", options: Options }
 *   main → worker: { type: "log", data: string }  (newline-delimited JSON)
 */

interface Options {
  url: string;
  organization: string;
  streamName: string;
  auth: { username: string; password: string };
  batchSize?: number;
  timeThresholdMs?: number;
}

let apiUrl: string;
let authHeader: string;

const BATCH_SIZE = 100;
const FLUSH_MS = 5_000;

let batchSize = BATCH_SIZE;
let flushMs = FLUSH_MS;
let logs: string[] = [];
let timer: Timer | null = null;
let sending = false;
let failures = 0;
let disabled = false;

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === "init") {
    const opts: Options = msg.options;
    apiUrl = `${opts.url}/api/${opts.organization}/${opts.streamName}/_multi`;
    authHeader = `Basic ${Buffer.from(`${opts.auth.username}:${opts.auth.password}`).toString("base64")}`;
    batchSize = opts.batchSize ?? BATCH_SIZE;
    flushMs = opts.timeThresholdMs ?? FLUSH_MS;
    return;
  }
  if (msg.type === "log" && !disabled) {
    // data is a JSON string (may have trailing newline)
    logs.push(msg.data.trimEnd());
    schedule();
  }
};

function schedule() {
  if (timer) clearTimeout(timer);
  if (logs.length >= batchSize && !sending) {
    void flush();
  } else {
    timer = setTimeout(() => void flush(), flushMs);
  }
}

async function flush() {
  if (!apiUrl || logs.length === 0 || sending) return;

  sending = true;
  const batch = logs.splice(0, batchSize);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: `[${batch.join(",")}]`,
    });

    if (!response.ok) {
      console.error("OpenObserve: failed to send logs:", response.status, response.statusText);
    }
  } catch (error: any) {
    const code = error?.cause?.code ?? error?.code;
    if (code === "ECONNREFUSED") {
      failures++;
      if (failures > 2) {
        disabled = true;
        console.warn("OpenObserve not responding. Disabling log transport.");
      }
    } else {
      console.error("OpenObserve: failed to send logs:", error);
    }
  } finally {
    sending = false;
    // If more logs accumulated while we were sending, schedule again
    if (logs.length > 0) schedule();
  }
}
