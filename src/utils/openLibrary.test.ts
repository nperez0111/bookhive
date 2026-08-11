import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { lookupIsbn, parseEdition } from "./openLibrary";

describe("parseEdition", () => {
  it("extracts workId and trimmed title", () => {
    expect(
      parseEdition({
        title: "  Foundation  ",
        works: [{ key: "/works/OL46125W" }],
      }),
    ).toEqual({ workId: "OL46125W", canonicalTitle: "Foundation" });
  });

  it("returns null when works is missing", () => {
    expect(parseEdition({ title: "x" })).toBe(null);
  });

  it("returns null on garbage input", () => {
    expect(parseEdition(null)).toBe(null);
    expect(parseEdition("nope")).toBe(null);
    expect(parseEdition({ works: [{ key: "/authors/OL12A" }] })).toBe(null);
  });
});

describe("lookupIsbn", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Each test installs its own mock; just guard against leaks.
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves and caches successful responses", async () => {
    const kv = createStorage({ driver: memoryDriver() });
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({ title: "Foundation", works: [{ key: "/works/OL46125W" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const first = await lookupIsbn(kv, "9780553293357");
    expect(first).toEqual({ workId: "OL46125W", canonicalTitle: "Foundation" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await lookupIsbn(kv, "9780553293357");
    expect(second).toEqual({ workId: "OL46125W", canonicalTitle: "Foundation" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not throw on 404", async () => {
    const kv = createStorage({ driver: memoryDriver() });
    globalThis.fetch = mock(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    expect(await lookupIsbn(kv, "9780000000000")).toBe(null);
  });

  it("rejects malformed ISBNs without calling fetch", async () => {
    const kv = createStorage({ driver: memoryDriver() });
    const fetchMock = mock(async () => new Response(""));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    expect(await lookupIsbn(kv, "")).toBe(null);
    expect(await lookupIsbn(kv, "12345")).toBe(null);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
