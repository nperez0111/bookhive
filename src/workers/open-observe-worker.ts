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
    apiUrl = `${opts.url.replace(/\/+$/, "")}/api/${encodeURIComponent(opts.organization)}/${encodeURIComponent(opts.streamName)}/_json`;
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

/**
 * Bun reports a refused connection as `code: "ConnectionRefused"`; Node uses
 * `ECONNREFUSED`. Matching only the Node spelling meant this never self-
 * disabled — every flush fell through to the generic branch instead, and
 * `console.error(error)` makes Bun print the error *with source context*,
 * which for a bundled worker is the entire minified file. That is a
 * multi-hundred-line non-JSON blob in stdout on every deploy.
 */
function isConnectionRefused(error: any): boolean {
  const code = error?.cause?.code ?? error?.code;
  return (
    code === "ConnectionRefused" ||
    code === "ECONNREFUSED" ||
    /unable to connect/i.test(error?.message ?? "")
  );
}

/**
 * One structured line, matching pino's shape. Everything this worker writes
 * lands in the same stdout stream as the app's logs, and ~4% of that stream
 * being unparseable is what forced `jq -R 'fromjson?'` during the incident.
 */
function logLine(level: number, msg: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, time: Date.now(), name: "open-observe", msg, ...fields }));
}

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
      const body = await response.text().catch(() => "");
      logLine(50, "openobserve_send_failed", {
        status: response.status,
        statusText: response.statusText,
        body: body.slice(0, 500),
      });
    }
  } catch (error: any) {
    if (isConnectionRefused(error)) {
      failures++;
      if (failures > 2) {
        disabled = true;
        logLine(40, "openobserve_disabled", {
          reason: "connection refused",
          url: apiUrl,
          failures,
        });
      }
    } else {
      logLine(50, "openobserve_send_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    sending = false;
    // If more logs accumulated while we were sending, schedule again
    if (logs.length > 0) schedule();
  }
}
