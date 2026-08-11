/**
 * Backfill progress persistence.
 *
 * `backfillCatalogBooks` runs for hours on the primary worker, but
 * `/admin/backfill-catalog/progress` is answered by whichever of the three
 * cluster workers the request lands on — and by a fresh process after any
 * restart. Without the KV mirror those requests reported `idle` for a job that
 * was running, or lost the outcome of one that had finished.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import type { Storage } from "unstorage";

import { getBackfillProgress, type BackfillProgress } from "./catalogBookService";

const KEY = "backfill:catalog_progress";

let kv: Storage;

beforeEach(() => {
  kv = createStorage({ driver: memoryDriver() });
});

function stored(overrides: Partial<BackfillProgress>): BackfillProgress {
  return {
    status: "running",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    written: 120,
    batches: 5,
    totalPending: 900,
    lastBatchAt: "2026-08-01T00:20:00.000Z",
    error: null,
    ...overrides,
  };
}

describe("getBackfillProgress", () => {
  it("reports idle when nothing has ever run", async () => {
    expect((await getBackfillProgress(kv)).status).toBe("idle");
  });

  it("still answers without a KV, for callers that have none", async () => {
    expect((await getBackfillProgress()).status).toBe("idle");
  });

  it("reads a completed run back out of the KV", async () => {
    await kv.setItem(KEY, stored({ status: "completed", completedAt: "2026-08-01T01:00:00.000Z" }));
    const progress = await getBackfillProgress(kv);
    expect(progress.status).toBe("completed");
    expect(progress.written).toBe(120);
    expect(progress.batches).toBe(5);
  });

  it("reports a stored 'running' as interrupted", async () => {
    // A genuinely live run answers from this process's memory, so a *stored*
    // "running" can only mean the process died mid-run. Leaving it as "running"
    // would show a job that never finishes and never fails.
    await kv.setItem(KEY, stored({ status: "running" }));
    const progress = await getBackfillProgress(kv);
    expect(progress.status).toBe("interrupted");
    expect(progress.completedAt).toBe("2026-08-01T00:20:00.000Z");
    expect(progress.error).toContain("restarted");
  });

  it("falls back to idle rather than throwing on an unusable entry", async () => {
    await kv.setItem(KEY, "{not json");
    expect((await getBackfillProgress(kv)).status).toBe("idle");
  });

  it("survives the JSON round trip unstorage actually performs", async () => {
    // The trap this pins: unstorage runs `destr` over what a driver returns, so
    // persisting `JSON.stringify(progress)` reads back as an object and any
    // `JSON.parse` of it throws — which silently discarded every stored run.
    // Store the object; let unstorage handle serialization.
    await kv.setItem(KEY, stored({ status: "completed" }));
    const raw = await kv.getItem(KEY);
    expect(typeof raw).toBe("object");
    expect((await getBackfillProgress(kv)).status).toBe("completed");
  });
});
