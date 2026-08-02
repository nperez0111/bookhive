import { describe, it, expect, beforeEach } from "bun:test";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { cachedOgRender, ogCacheKey } from "./ogCache";

let kv: ReturnType<typeof createStorage>;

beforeEach(() => {
  kv = createStorage({ driver: memoryDriver() });
});

const bytesOf = (n: number) => new ArrayBuffer(n);

describe("ogCacheKey", () => {
  it("is stable for identical props and distinct across kinds", () => {
    expect(ogCacheKey("book", { id: "bk_1" })).toBe(ogCacheKey("book", { id: "bk_1" }));
    expect(ogCacheKey("book", { id: "bk_1" })).not.toBe(ogCacheKey("author", { id: "bk_1" }));
    expect(ogCacheKey("book", { id: "bk_1" })).not.toBe(ogCacheKey("book", { id: "bk_2" }));
  });

  it("is bounded in length regardless of prop size", () => {
    // The old key inlined JSON.stringify(props) — an unbounded string as a
    // primary key on every cached row.
    const huge = { description: "x".repeat(100_000) };
    expect(ogCacheKey("book", huge).length).toBeLessThan(40);
  });
});

describe("cachedOgRender", () => {
  it("renders once and serves the rest from the cache", async () => {
    let renders = 0;
    const render = async () => {
      renders++;
      return bytesOf(16);
    };
    const key = ogCacheKey("book", { id: "bk_1" });

    const first = await cachedOgRender(kv, key, 60, render);
    const second = await cachedOgRender(kv, key, 60, render);

    expect(renders).toBe(1);
    expect(first.byteLength).toBe(16);
    expect(second.byteLength).toBe(16);
  });

  it("round-trips bytes exactly through base64", async () => {
    const source = new Uint8Array([0, 1, 127, 128, 255, 254, 42]);
    const key = ogCacheKey("book", { id: "bytes" });
    await cachedOgRender(kv, key, 60, async () => source.buffer as ArrayBuffer);

    const fromCache = await cachedOgRender(kv, key, 60, async () => {
      throw new Error("should not re-render");
    });
    expect([...fromCache]).toEqual([...source]);
  });

  it("re-renders once the entry has expired", async () => {
    let renders = 0;
    const render = async () => {
      renders++;
      return bytesOf(8);
    };
    const key = ogCacheKey("book", { id: "bk_ttl" });

    await cachedOgRender(kv, key, 0, render);
    await cachedOgRender(kv, key, 0, render);
    expect(renders).toBe(2);
  });

  it("collapses a concurrent burst into a single render", async () => {
    // A crawler hitting one cold card N ways must not start N renders — each
    // one is a full 1200x630 rasterisation in the render worker.
    let renders = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const render = async () => {
      renders++;
      await gate;
      return bytesOf(4);
    };
    const key = ogCacheKey("book", { id: "bk_burst" });

    const all = Promise.all(Array.from({ length: 10 }, () => cachedOgRender(kv, key, 60, render)));
    release();
    const results = await all;

    expect(renders).toBe(1);
    expect(results.every((r) => r.byteLength === 4)).toBe(true);
  });

  it("still returns the image when the cache write fails", async () => {
    const broken = createStorage({ driver: memoryDriver() });
    broken.set = async () => {
      throw new Error("disk full");
    };
    const key = ogCacheKey("book", { id: "bk_nowrite" });

    const result = await cachedOgRender(broken, key, 60, async () => bytesOf(12));
    expect(result.byteLength).toBe(12);
  });

  it("does not leave the in-flight entry behind after a failed render", async () => {
    const key = ogCacheKey("book", { id: "bk_fail" });
    await expect(
      cachedOgRender(kv, key, 60, async () => {
        throw new Error("render exploded");
      }),
    ).rejects.toThrow("render exploded");

    // A stuck in-flight promise would make the card permanently unrenderable.
    const recovered = await cachedOgRender(kv, key, 60, async () => bytesOf(3));
    expect(recovered.byteLength).toBe(3);
  });
});
