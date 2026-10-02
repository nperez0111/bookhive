import { afterEach, describe, expect, it } from "bun:test";

import { deleteBook, writeBook } from "./bookApi";

describe("book write response contract", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("rejects successful HTTP responses without an acknowledged canonical update", async () => {
    for (const body of [{ success: true }, {}]) {
      globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch;
      const result = await writeBook("bk_dune", { stars: 8 });
      expect(result.ok).toBe(false);
    }
  });

  it("accepts a successful deletion without a userBook payload", async () => {
    globalThis.fetch = (async () => Response.json({ success: true })) as unknown as typeof fetch;
    expect(await deleteBook("bk_dune")).toEqual({ ok: true, userBook: null });
  });
});
