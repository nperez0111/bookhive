import { afterEach, describe, expect, it, mock } from "bun:test";
import Goodreads from "./goodreads";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const base = "https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1562663148l/";

function mockSearch(imageUrl: string) {
  globalThis.fetch = mock(async () =>
    Response.json([
      {
        imageUrl,
        bookId: "51256920",
        bookTitleBare: "Test Book",
        title: "Test Book",
        author: { name: "Test Author" },
        avgRating: "4.2",
        ratingsCount: 10,
        description: { html: "<p>Description</p>" },
      },
    ]),
  ) as unknown as typeof fetch;
}

describe("Goodreads cover ingestion", () => {
  for (const filename of ["51256920._SY75_.jpg", "51256920SY75_.jpg"]) {
    it(`stores a full-size cover and valid thumbnail from ${filename}`, async () => {
      const tail = "?v=%2f&x=one+two#cover";
      mockSearch(`${base}${filename}${tail}`);
      const books = await new Goodreads().search("test");
      expect(books).toHaveLength(1);
      expect(books[0]?.cover).toBe(`${base}51256920.jpg${tail}`);
      expect(books[0]?.thumbnail).toBe(`${base}51256920._SY75_.jpg${tail}`);
    });
  }

  it("keeps a full-size source unchanged", async () => {
    mockSearch(`${base}51256920.jpg`);
    const [book] = await new Goodreads().search("test");
    expect(book?.cover).toBe(`${base}51256920.jpg`);
    expect(book?.thumbnail).toBe(`${base}51256920.jpg`);
  });

  it("does not strip suffix-like data from a different provider", async () => {
    const source = "https://images.example.com/51256920._SY75_.jpg";
    mockSearch(source);
    const [book] = await new Goodreads().search("test");
    expect(book?.cover).toBe(source);
    expect(book?.thumbnail).toBe(source);
  });

  it("preserves the generic-cover fallback when no image is supplied", async () => {
    mockSearch("");
    const [book] = await new Goodreads().search("test", "/fallback.jpg");
    expect(book?.cover).toBe("/fallback.jpg");
    expect(book?.thumbnail).toBe("");
  });
});
