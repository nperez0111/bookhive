/**
 * The pure half of `syncDocuments.ts`.
 *
 * `JSON.parse(row.progressData)` was unguarded in four of the five readers, so
 * one malformed blob 500'd both KOSync routes and both XRPC methods — an
 * e-reader's sync and the iOS library screen — while the web page shrugged and
 * rendered 0%. That asymmetry is what these tests exist to stop coming back.
 */
import { describe, it, expect } from "bun:test";
import { parseSyncProgress, syncProgressView } from "./syncDocuments";

const blob = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    progress: "/body/DocFragment[3]",
    percentage: 0.42,
    device: "Kobo",
    device_id: "abc",
    timestamp: 1_700_000_000,
    ...over,
  });

describe("parseSyncProgress", () => {
  it("reads a well-formed blob", () => {
    const data = parseSyncProgress(blob());
    expect(data?.percentage).toBe(0.42);
    expect(data?.device).toBe("Kobo");
  });

  it("returns null instead of throwing on malformed JSON", () => {
    // This is the whole point: a row we cannot read is a row with no progress,
    // not a 500 on someone's e-reader sync.
    expect(parseSyncProgress("{not json")).toBeNull();
    expect(parseSyncProgress("")).toBeNull();
    expect(parseSyncProgress(null)).toBeNull();
    expect(parseSyncProgress(undefined)).toBeNull();
  });

  it("does not throw on JSON that parses to the wrong shape", () => {
    // The column is a blob written by a client; it can be anything.
    expect(() => parseSyncProgress("[]")).not.toThrow();
    expect(() => parseSyncProgress("null")).not.toThrow();
    expect(() => parseSyncProgress('"a string"')).not.toThrow();
  });
});

describe("syncProgressView", () => {
  it("shapes a synced document into the lexicon's view", () => {
    expect(syncProgressView(blob(), "2026-01-01T00:00:00.000Z")).toEqual({
      percentage: "0.42",
      device: "Kobo",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits percentage as a string, because the lexicon declares one", () => {
    // KOSync's REST twin answers a number — that is KOReader's wire format.
    // Both are right for their protocol; only this one is a string.
    const view = syncProgressView(blob({ percentage: 1 }), "2026-01-01T00:00:00.000Z");
    expect(view?.percentage).toBe("1");
    expect(typeof view?.percentage).toBe("string");
  });

  it("is undefined when the document has never been synced", () => {
    expect(syncProgressView(blob(), null)).toBeUndefined();
    expect(syncProgressView(null, "2026-01-01T00:00:00.000Z")).toBeUndefined();
  });

  it("is undefined rather than throwing when the blob is unreadable", () => {
    expect(syncProgressView("{corrupt", "2026-01-01T00:00:00.000Z")).toBeUndefined();
  });

  it("defaults a missing percentage to zero rather than emitting 'undefined'", () => {
    // `String(data.percentage)` on an absent key yields the literal string
    // "undefined", which a client renders as a progress bar of NaN%.
    const view = syncProgressView(JSON.stringify({ device: "Kobo" }), "2026-01-01T00:00:00.000Z");
    expect(view?.percentage).toBe("0");
  });

  it("drops an empty device name rather than reporting one", () => {
    const view = syncProgressView(blob({ device: "" }), "2026-01-01T00:00:00.000Z");
    expect(view?.device).toBeUndefined();
  });
});
