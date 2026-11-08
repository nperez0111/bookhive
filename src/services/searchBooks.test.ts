import { expect, it, mock } from "bun:test";
import { createStorage } from "unstorage";
import type { SearchBooksContext } from "./searchBooks";

// Existing import suites permanently mock searchBooks. Isolate both directions
// so this exercises the real cache + miss limiter without polluting other tests.
if (process.env["BOOKHIVE_SEARCH_ADMISSION_CHECK"] === "1") {
  let active = 0;
  let peak = 0;
  let allowUpstream = false;
  const started: string[] = [];
  const releases: Array<() => void> = [];
  void mock.module("../scrapers", () => ({
    findBookDetails: async (query: string) => {
      started.push(query);
      active++;
      peak = Math.max(peak, active);
      try {
        if (!allowUpstream) await new Promise<void>((resolve) => releases.push(resolve));
        if (query === "fail") throw new Error("upstream failed");
        return { success: false };
      } finally {
        active--;
      }
    },
  }));
  void mock.module("../data/catalogBooks", () => ({ searchLocalCatalog: async () => [] }));
  const { searchBooks, getSearchAdmissionState } = await import("./searchBooks");
  const events: Array<Record<string, unknown>> = [];
  const kv = createStorage();
  const ctx: SearchBooksContext = {
    kv,
    db: {} as SearchBooksContext["db"],
    addWideEventContext: (event) => {
      events.push(event);
    },
  };
  await kv.set("search:cached", ["bk_cached"]);
  await kv.setMeta("search:cached", { timestamp: Date.now() });
  const first = searchBooks({ query: "same", ctx });
  const duplicates = Array.from({ length: 20 }, () => searchBooks({ query: "same", ctx }));
  const unique = Array.from({ length: 79 }, (_, i) =>
    searchBooks({ query: `different-${i}`, ctx }),
  );
  for (let i = 0; i < 100 && getSearchAdmissionState().missPending < 64; i++) await Bun.sleep(1);
  expect(getSearchAdmissionState().missActive).toBe(3);
  expect(getSearchAdmissionState().missPending).toBe(64);
  expect(started.filter((q) => q === "same")).toHaveLength(1);
  expect(await searchBooks({ query: "cached", ctx })).toEqual(["bk_cached"]);
  expect(started).not.toContain("cached");
  expect(events.some((event) => event["search_miss"] === "failed")).toBe(true);
  allowUpstream = true;
  releases.forEach((release) => release());
  await Promise.all([first, ...duplicates, ...unique]);
  expect(peak).toBe(3);
  expect(getSearchAdmissionState().missActive).toBe(0);
  expect(getSearchAdmissionState().missPending).toBe(0);
  expect(await searchBooks({ query: "fail", ctx })).toEqual([]);
  expect(getSearchAdmissionState().missActive).toBe(0);
} else {
  it("shares bounded distinct cache misses after dedupe while cache hits bypass saturation", async () => {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      env: { ...process.env, BOOKHIVE_SEARCH_ADMISSION_CHECK: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
  });
}
