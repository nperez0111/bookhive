import { describe, expect, it, mock } from "bun:test";
import { withTimeout } from "../lib/semaphore";
import { createRepoLister } from "./repoCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("PDS repo directory cache", () => {
  it("deduplicates cold readers, paginates, excludes inactive repos, and caches the full snapshot", async () => {
    const gate = deferred<void>();
    const fetchPage = mock(async (cursor: string | undefined) => {
      await gate.promise;
      return cursor
        ? { repos: [{ did: "did:plc:bob" }, { did: "did:plc:alice" }] }
        : {
            repos: [{ did: "did:plc:alice" }, { did: "did:plc:inactive", active: false }],
            cursor: "next",
          };
    });
    const list = createRepoLister(fetchPage);
    const first = list();
    const second = list();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect(await first).toEqual(["did:plc:alice", "did:plc:bob"]);
    expect(await second).toEqual(await first);
    expect(await list()).toEqual(await first);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("serves stale immediately while exactly one deferred refresh runs", async () => {
    let now = 0;
    const gate = deferred<{ repos: { did: string }[] }>();
    const fetchPage = mock(() =>
      fetchPage.mock.calls.length === 1
        ? Promise.resolve({ repos: [{ did: "old" }] })
        : gate.promise,
    );
    const list = createRepoLister(fetchPage, { now: () => now });
    expect(await list()).toEqual(["old"]);
    now = 6 * 60_000;
    expect(await withTimeout(list(), 100, "stale repo list")).toEqual(["old"]);
    expect(await withTimeout(list(), 100, "second stale repo list")).toEqual(["old"]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    gate.resolve({ repos: [{ did: "new" }] });
    await Bun.sleep(1);
    expect(await list()).toEqual(["new"]);
  });

  it("negative-caches a successful empty directory", async () => {
    const fetchPage = mock(async () => ({ repos: [] }));
    const list = createRepoLister(fetchPage);
    expect(await list()).toEqual([]);
    expect(await list()).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("backs off cold failures and permits a retry after 30 seconds", async () => {
    let now = 0;
    const fetchPage = mock(async () => {
      throw new Error("offline");
    });
    const list = createRepoLister(fetchPage, { now: () => now });
    expect(await list()).toEqual([]);
    expect(await list()).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    now = 30_001;
    await list();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does not replace a previous snapshot with a partial failed traversal", async () => {
    let now = 0;
    let failure = false;
    const fetchPage = mock(async (cursor: string | undefined) => {
      if (!failure) return { repos: [{ did: "cached" }] };
      if (cursor) throw new Error("second page failed");
      return { repos: [{ did: "partial" }], cursor: "next" };
    });
    const list = createRepoLister(fetchPage, { now: () => now });
    expect(await list()).toEqual(["cached"]);
    now = 6 * 60_000;
    failure = true;
    expect(await list()).toEqual(["cached"]);
    await Bun.sleep(1);
    expect(await list()).toEqual(["cached"]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("bounds the entire traversal with a deadline and aborts its fetch signal", async () => {
    let now = 0;
    let signal: AbortSignal | undefined;
    const gate = deferred<{ repos: { did: string }[] }>();
    const fetchPage = mock(async (_cursor: string | undefined, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return gate.promise;
    });
    const list = createRepoLister(fetchPage, { timeoutMs: 10, now: () => now });
    expect(await withTimeout(list(), 200, "directory cold deadline")).toEqual([]);
    expect(signal?.aborted).toBe(true);
    expect(await list()).toEqual([]);
    now = 30_001;
    expect(await list()).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    gate.resolve({ repos: [{ did: "late" }] });
    await Bun.sleep(1);
    expect(await list()).toEqual(["late"]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops repeated cursors and rejects a partial snapshot", async () => {
    const fetchPage = mock(async () => ({ repos: [{ did: "partial" }], cursor: "same" }));
    const list = createRepoLister(fetchPage);
    expect(await list()).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(await list()).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("caps page count when a server returns endless unique cursors", async () => {
    const fetchPage = mock(async () => ({
      repos: [{ did: "partial" }],
      cursor: String(fetchPage.mock.calls.length),
    }));
    expect(await createRepoLister(fetchPage)()).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(10);
  });

  it("does not serve a snapshot older than the hard TTL during an outage", async () => {
    let now = 0;
    const fetchPage = mock(async () => {
      if (now > 0) throw new Error("offline");
      return { repos: [{ did: "old" }] };
    });
    const list = createRepoLister(fetchPage, { now: () => now });
    expect(await list()).toEqual(["old"]);
    now = 25 * 60 * 60_000;
    expect(await list()).toEqual([]);
  });
});
