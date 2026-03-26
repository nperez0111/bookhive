import { describe, it, expect } from "bun:test";
import { normalizeGoodreadsId, deriveBookIdentifiers } from "./bookIdentifiers";

describe("normalizeGoodreadsId", () => {
  it("returns numeric Goodreads IDs", () => {
    expect(normalizeGoodreadsId("12345")).toBe("12345");
    expect(normalizeGoodreadsId("18143945")).toBe("18143945");
  });

  it("extracts numeric part from ID.title-slug format", () => {
    expect(normalizeGoodreadsId("12345.my-book-title")).toBe("12345");
  });

  it("rejects Amazon/Kindle identifiers", () => {
    expect(normalizeGoodreadsId("kca://book/amzn1")).toBe(null);
    expect(normalizeGoodreadsId("amzn1.book.123")).toBe(null);
  });

  it("returns null for empty or invalid input", () => {
    expect(normalizeGoodreadsId("")).toBe(null);
    expect(normalizeGoodreadsId(null)).toBe(null);
    expect(normalizeGoodreadsId(undefined)).toBe(null);
    expect(normalizeGoodreadsId("  ")).toBe(null);
  });
});

describe("deriveBookIdentifiers", () => {
  it("extracts goodreadsId from sourceId when source is Goodreads", () => {
    const result = deriveBookIdentifiers({
      id: "bk_test",
      source: "Goodreads",
      sourceId: "12345",
      sourceUrl: "https://www.goodreads.com/book/show/12345",
      meta: null,
    });
    expect(result.goodreadsId).toBe("12345");
  });

  it("rejects invalid goodreadsId from sourceId", () => {
    const result = deriveBookIdentifiers({
      id: "bk_test",
      source: "Goodreads",
      sourceId: "kca://book/amzn1",
      sourceUrl: "https://www.goodreads.com/book/show/kca://book/amzn1",
      meta: null,
    });
    expect(result.goodreadsId).toBe(null);
  });

  it("falls back to sourceUrl when sourceId is invalid", () => {
    const result = deriveBookIdentifiers({
      id: "bk_test",
      source: "Goodreads",
      sourceId: "kca://book/amzn1",
      sourceUrl: "https://www.goodreads.com/book/show/12345-my-book",
      meta: null,
    });
    expect(result.goodreadsId).toBe("12345");
  });
});
