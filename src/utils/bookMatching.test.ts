import { describe, expect, it } from "bun:test";
import {
  bookEquivalenceKey,
  contentWordsMatch,
  normalizeCompact,
  normalizeForMatch,
  similarityScore,
} from "./bookMatching";

describe("normalizeForMatch", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeForMatch("The Great Gatsby!")).toBe("the great gatsby");
    expect(normalizeForMatch("  multiple   spaces  ")).toBe("multiple spaces");
  });
});

describe("normalizeCompact", () => {
  it("strips every non-alphanumeric character", () => {
    expect(normalizeCompact("F. Scott Fitzgerald")).toBe("fscottfitzgerald");
    expect(normalizeCompact("F Scott Fitzgerald")).toBe("fscottfitzgerald");
  });
});

describe("similarityScore", () => {
  it("returns 1 for exact normalized matches", () => {
    expect(similarityScore("The Great Gatsby", "the great gatsby")).toBe(1);
    expect(similarityScore("The Great Gatsby!", "The Great Gatsby")).toBe(1);
  });

  it("returns 0 for completely disjoint titles", () => {
    expect(similarityScore("Foundation", "Cryptonomicon")).toBe(0);
  });

  it("scores partial overlap proportionally", () => {
    const score = similarityScore("Children of Time", "Children of Ruin");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });
});

describe("contentWordsMatch", () => {
  it("rejects series stem collisions", () => {
    // The whole point of the gate: ditch series-mate false positives.
    expect(contentWordsMatch("Children of Time", "Children of Ruin")).toBe(false);
  });

  it("allows the candidate to carry extra words (subtitles)", () => {
    expect(contentWordsMatch("Foundation", "Foundation: The Empire Trilogy")).toBe(true);
  });

  it("ignores stop words and punctuation", () => {
    expect(contentWordsMatch("The Lord of the Rings!", "lord of the rings")).toBe(true);
  });

  it("returns true when search has no content words", () => {
    expect(contentWordsMatch("the and of", "anything")).toBe(true);
  });
});

describe("bookEquivalenceKey", () => {
  it("prefers olWorkId when present", () => {
    expect(
      bookEquivalenceKey({
        title: "Foundation",
        author: "Isaac Asimov",
        olWorkId: "OL46125W",
      }),
    ).toBe("work:OL46125W");
  });

  it("falls back to compact title+author when olWorkId is missing", () => {
    expect(
      bookEquivalenceKey({
        title: "F. Scott's Gatsby!",
        author: "Fitzgerald",
      }),
    ).toBe("fuzzy:fscottsgatsby\0fitzgerald");
  });

  it("collapses punctuation/case variants", () => {
    const a = bookEquivalenceKey({
      title: "The Great Gatsby",
      author: "F. Scott Fitzgerald",
    });
    const b = bookEquivalenceKey({
      title: "the  great  gatsby",
      author: "F Scott Fitzgerald",
    });
    expect(a).toBe(b);
  });
});
