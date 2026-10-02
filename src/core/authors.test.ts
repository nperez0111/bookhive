import { describe, it, expect } from "bun:test";
import { parseAuthors, formatAuthors, displayAuthors, primaryAuthor } from "./authors";

describe("parseAuthors", () => {
  it("parses a single author", () => {
    expect(parseAuthors("Brandon Sanderson")).toEqual(["Brandon Sanderson"]);
  });

  it("parses multiple authors", () => {
    expect(parseAuthors("Brandon Sanderson\tHoward Tayler\tDan Wells")).toEqual([
      "Brandon Sanderson",
      "Howard Tayler",
      "Dan Wells",
    ]);
  });

  it("drops empty segments", () => {
    expect(parseAuthors("Brandon Sanderson\t\tHoward Tayler")).toEqual([
      "Brandon Sanderson",
      "Howard Tayler",
    ]);
    expect(parseAuthors("A\t\tB\t")).toEqual(["A", "B"]);
  });

  // Migration 020's trigger stores `trim(substr(...))`, so an untrimmed name
  // here produces an /authors/ link that matches no `hive_book_author` row.
  it("trims, matching what hive_book_author stores", () => {
    expect(parseAuthors("  Ursula K. Le Guin  ")).toEqual(["Ursula K. Le Guin"]);
    expect(parseAuthors("A \t B")).toEqual(["A", "B"]);
  });

  it("handles empty and absent input", () => {
    expect(parseAuthors("")).toEqual([]);
    expect(parseAuthors(null)).toEqual([]);
    expect(parseAuthors(undefined)).toEqual([]);
  });
});

describe("formatAuthors", () => {
  it("joins with tabs", () => {
    expect(formatAuthors(["Brandon Sanderson"])).toBe("Brandon Sanderson");
    expect(formatAuthors(["Brandon Sanderson", "Howard Tayler"])).toBe(
      "Brandon Sanderson\tHoward Tayler",
    );
    expect(formatAuthors([])).toBe("");
  });

  it("round-trips through parseAuthors", () => {
    const authors = ["Ann Leckie", "Becky Chambers"];
    expect(parseAuthors(formatAuthors(authors))).toEqual(authors);
  });
});

describe("displayAuthors", () => {
  it("renders a comma list", () => {
    expect(displayAuthors("Ann Leckie\tBecky Chambers")).toBe("Ann Leckie, Becky Chambers");
  });

  // The old `split("\t").join(", ")` spelling rendered "A, , B" here, and the
  // `replace(/\t/g, ", ")` spelling in BookCard did the same.
  it("does not emit an empty slot for an empty segment", () => {
    expect(displayAuthors("Ann Leckie\t\tBecky Chambers")).toBe("Ann Leckie, Becky Chambers");
  });

  it("is empty for absent authors", () => {
    expect(displayAuthors(null)).toBe("");
    expect(displayAuthors("")).toBe("");
  });
});

describe("primaryAuthor", () => {
  it("returns the credited first author", () => {
    expect(primaryAuthor("Ann Leckie\tBecky Chambers")).toBe("Ann Leckie");
  });

  it("returns an empty string when there is none", () => {
    expect(primaryAuthor(null)).toBe("");
    expect(primaryAuthor("\t\t")).toBe("");
  });
});
