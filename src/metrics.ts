/**
 * Lightweight Prometheus metrics — no external deps, no JSON.stringify on hot paths.
 *
 * All metric operations use a pre-computed string key so the hot path is just
 * a Map.get + Map.set with a primitive key. The Prometheus text format string
 * for each label set is also pre-computed once via `labelKey()`.
 */

// ─── Label key helper ───────────────────────────────────────────────────────
// Call once at init time, reuse the returned string on every inc/dec/observe.

export function labelKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
}

// ─── Core metric classes ────────────────────────────────────────────────────

export class Counter {
  /** Map from pre-computed labelKey string → value */
  private values = new Map<string, number>();

  constructor(
    private name: string,
    private help: string,
  ) {}

  inc(key = "", value = 1): void {
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  getValue(key = ""): number {
    return this.values.get(key) || 0;
  }

  toString(): string {
    let output = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n`;
    if (this.values.size === 0) {
      output += `${this.name} 0\n`;
    } else {
      for (const [key, value] of this.values) {
        output += `${this.name}${key} ${value}\n`;
      }
    }
    return output;
  }
}

export class Gauge {
  private values = new Map<string, number>();

  constructor(
    private name: string,
    private help: string,
  ) {}

  inc(key = ""): void {
    this.values.set(key, (this.values.get(key) || 0) + 1);
  }

  dec(key = ""): void {
    this.values.set(key, (this.values.get(key) || 0) - 1);
  }

  set(value: number, key = ""): void {
    this.values.set(key, value);
  }

  getValue(key = ""): number {
    return this.values.get(key) || 0;
  }

  toString(): string {
    let output = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n`;
    if (this.values.size === 0) {
      output += `${this.name} 0\n`;
    } else {
      for (const [key, value] of this.values) {
        output += `${this.name}${key} ${value}\n`;
      }
    }
    return output;
  }
}

export class Histogram {
  private series = new Map<
    string,
    { buckets: number[]; sum: number; count: number }
  >();

  /** Pre-built le= suffix strings for each bucket, computed once in constructor */
  private leSuffixes: string[];
  private leInfSuffix: string;
  private bucketLen: number;

  constructor(
    private name: string,
    private help: string,
    private bucketValues: number[] = [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ],
  ) {
    this.bucketLen = bucketValues.length;
    // Pre-compute le= label suffixes so toString() is just string concat
    this.leSuffixes = bucketValues.map((b) => `le="${b}"`);
    this.leInfSuffix = `le="+Inf"`;
  }

  observe(value: number, key = ""): void {
    let series = this.series.get(key);

    if (!series) {
      series = {
        buckets: Array.from({ length: this.bucketLen + 1 }, () => 0),
        sum: 0,
        count: 0,
      };
      this.series.set(key, series);
    }

    series.count++;
    series.sum += value;

    const buckets = series.buckets;
    const bv = this.bucketValues;
    for (let i = 0; i < this.bucketLen; i++) {
      if (value <= bv[i]!) {
        buckets[i]!++;
      }
    }
    buckets[this.bucketLen]!++; // +Inf
  }

  startTimer(key = ""): () => void {
    const start = performance.now();
    return () => {
      this.observe((performance.now() - start) / 1000, key);
    };
  }

  toString(): string {
    const name = this.name;
    let output = `# HELP ${name} ${this.help}\n# TYPE ${name} histogram\n`;

    if (this.series.size === 0) {
      for (const le of this.leSuffixes) {
        output += `${name}_bucket{${le}} 0\n`;
      }
      output += `${name}_bucket{${this.leInfSuffix}} 0\n`;
      output += `${name}_count 0\n`;
      output += `${name}_sum 0\n`;
    } else {
      for (const [key, series] of this.series) {
        // key is already "{foo="bar"}" or "", so we merge with le=
        const hasLabels = key.length > 0;
        const inner = hasLabels ? key.slice(1, -1) + "," : "";

        for (let i = 0; i < this.bucketLen; i++) {
          output += `${name}_bucket{${inner}${this.leSuffixes[i]}} ${series.buckets[i]}\n`;
        }
        output += `${name}_bucket{${inner}${this.leInfSuffix}} ${series.buckets[this.bucketLen]}\n`;
        output += `${name}_count${key} ${series.count}\n`;
        output += `${name}_sum${key} ${series.sum}\n`;
      }
    }
    return output;
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

class Registry {
  private metrics: (Counter | Gauge | Histogram)[] = [];

  register<T extends Counter | Gauge | Histogram>(metric: T): T {
    this.metrics.push(metric);
    return metric;
  }

  format(): string {
    return this.metrics.map((m) => m.toString()).join("\n") + "\n";
  }
}

export const registry = new Registry();

// ─── Operation duration histograms ──────────────────────────────────────────

const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

export const imageProcessingDuration = registry.register(
  new Histogram(
    "bookhive_image_processing_duration_seconds",
    "Duration of image processing operations",
    DURATION_BUCKETS,
  ),
);

export const scraperDuration = registry.register(
  new Histogram(
    "bookhive_scraper_duration_seconds",
    "Duration of scraper operations",
    DURATION_BUCKETS,
  ),
);

export const importBatchDuration = registry.register(
  new Histogram(
    "bookhive_import_batch_duration_seconds",
    "Duration of import batch processing",
    [0.5, 1, 2.5, 5, 10, 30, 60],
  ),
);

export const ingesterEventDuration = registry.register(
  new Histogram(
    "bookhive_ingester_event_duration_seconds",
    "Duration of ingester event processing",
    [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  ),
);

export const followSyncDuration = registry.register(
  new Histogram(
    "bookhive_follow_sync_duration_seconds",
    "Duration of follow sync operations",
    [0.5, 1, 2.5, 5, 10, 30, 60],
  ),
);

// ─── Concurrency gauges ─────────────────────────────────────────────────────

export const activeOperations = registry.register(
  new Gauge(
    "bookhive_active_operations",
    "Number of currently active expensive operations",
  ),
);

export const ingesterBackfillActive = registry.register(
  new Gauge(
    "bookhive_ingester_backfill_active",
    "Number of currently active ingester backfills",
  ),
);

export const ingesterBackfillQueueDepth = registry.register(
  new Gauge(
    "bookhive_ingester_backfill_queue_depth",
    "Number of backfills waiting in queue",
  ),
);

// ─── Counters ───────────────────────────────────────────────────────────────

export const importBooksTotal = registry.register(
  new Counter(
    "bookhive_import_books_total",
    "Total books processed during imports",
  ),
);

export const ingesterEventsTotal = registry.register(
  new Counter(
    "bookhive_ingester_events_total",
    "Total ingester events processed",
  ),
);

export const scraperRequestsTotal = registry.register(
  new Counter(
    "bookhive_scraper_requests_total",
    "Total scraper requests",
  ),
);

// ─── Runtime gauges ─────────────────────────────────────────────────────────

export const processMemoryBytes = registry.register(
  new Gauge(
    "bookhive_process_memory_bytes",
    "Process memory usage in bytes",
  ),
);

export const processCpuSecondsTotal = registry.register(
  new Counter(
    "bookhive_process_cpu_seconds_total",
    "Total CPU time in seconds",
  ),
);

export const eventLoopLag = registry.register(
  new Histogram(
    "bookhive_event_loop_lag_seconds",
    "Event loop lag measured every 5 seconds",
    [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  ),
);

// ─── Pre-computed label keys (used by call sites) ───────────────────────────
// These are computed once at module load. Hot paths just pass the string.

export const LABEL = {
  op: {
    resize: labelKey({ operation: "resize" }),
    og_image: labelKey({ operation: "og_image" }),
    scrape: labelKey({ operation: "scrape" }),
    import: labelKey({ operation: "import" }),
  },
  scraper: {
    search: labelKey({ source: "goodreads", operation: "search" }),
    enrich: labelKey({ source: "goodreads", operation: "enrich" }),
  },
  scraperOutcome: {
    success: labelKey({ source: "goodreads", outcome: "success" }),
    empty: labelKey({ source: "goodreads", outcome: "empty" }),
    error: labelKey({ source: "goodreads", outcome: "error" }),
  },
  import: {
    goodreads: labelKey({ source: "goodreads" }),
    storygraph: labelKey({ source: "storygraph" }),
  },
  importOutcome: {
    goodreadsMatched: labelKey({ source: "goodreads", outcome: "matched" }),
    goodreadsUnmatched: labelKey({ source: "goodreads", outcome: "unmatched" }),
    storygraphMatched: labelKey({ source: "storygraph", outcome: "matched" }),
    storygraphUnmatched: labelKey({ source: "storygraph", outcome: "unmatched" }),
  },
  followSync: {
    full: labelKey({ sync_type: "full" }),
    incremental: labelKey({ sync_type: "incremental" }),
  },
  mem: {
    rss: labelKey({ type: "rss" }),
    heapTotal: labelKey({ type: "heap_total" }),
    heapUsed: labelKey({ type: "heap_used" }),
  },
  cpu: {
    user: labelKey({ type: "user" }),
    system: labelKey({ type: "system" }),
  },
} as const;

// ─── Runtime metrics collection ─────────────────────────────────────────────

let runtimeInterval: ReturnType<typeof setInterval> | null = null;
let lastCpuUser = 0;
let lastCpuSystem = 0;

export function startRuntimeMetricsCollection(): void {
  if (runtimeInterval) return;

  const initial = process.resourceUsage();
  lastCpuUser = initial.userCPUTime;
  lastCpuSystem = initial.systemCPUTime;

  let lastCheck = performance.now();

  runtimeInterval = setInterval(() => {
    const mem = process.memoryUsage();
    processMemoryBytes.set(mem.rss, LABEL.mem.rss);
    processMemoryBytes.set(mem.heapTotal, LABEL.mem.heapTotal);
    processMemoryBytes.set(mem.heapUsed, LABEL.mem.heapUsed);

    const usage = process.resourceUsage();
    const userDelta = (usage.userCPUTime - lastCpuUser) / 1_000_000;
    const systemDelta = (usage.systemCPUTime - lastCpuSystem) / 1_000_000;
    if (userDelta > 0) processCpuSecondsTotal.inc(LABEL.cpu.user, userDelta);
    if (systemDelta > 0) processCpuSecondsTotal.inc(LABEL.cpu.system, systemDelta);
    lastCpuUser = usage.userCPUTime;
    lastCpuSystem = usage.systemCPUTime;

    const now = performance.now();
    const lag = Math.max(0, (now - lastCheck - 5000) / 1000);
    eventLoopLag.observe(lag);
    lastCheck = now;
  }, 5000);

  if (runtimeInterval.unref) {
    runtimeInterval.unref();
  }
}
