/**
 * Fuzzy title primitives, used by tier 3 of KOReader document matching.
 *
 * The invariant across all of `syncMatching` is that **a wrong link is worse
 * than no link** — it writes progress onto a book the user isn't reading and
 * mirrors it to their PDS, where a miss just leaves the document to be linked
 * by hand. So the cases that matter here are the near-misses.
 */
import { describe, it, expect } from "bun:test";
import {
  contentWords,
  contentWordsMatch,
  normalizeForMatch,
  similarityScore,
} from "./bookMatching";

describe("normalizeForMatch", () => {
  it("deletes punctuation rather than replacing it with a space", () => {
    // The documented reason: "hitchhiker's" and "hitchhikers" must collapse
    // onto one word instead of differing by a stray "s" token.
    expect(normalizeForMatch("Hitchhiker's")).toBe("hitchhikers");
    expect(normalizeForMatch("Hitchhikers")).toBe("hitchhikers");
  });

  it("lowercases and collapses whitespace", () => {
    expect(normalizeForMatch("  The   GREAT   Gatsby ")).toBe("the great gatsby");
  });

  it("drops non-ASCII, so it cannot be relied on alone for those titles", () => {
    // Worth pinning: this is why tier 3 also searches by author, whose name is
    // spelled the same either way.
    expect(normalizeForMatch("Les Misérables")).toBe("les misrables");
  });
});

describe("contentWords", () => {
  it("removes stop words", () => {
    expect(contentWords("The Lord of the Rings")).toEqual(["lord", "rings"]);
  });

  it("returns nothing for a title made only of stop words", () => {
    expect(contentWords("The And Of")).toEqual([]);
  });
});

describe("similarityScore", () => {
  it("is 1 for an exact normalized match", () => {
    expect(similarityScore("Dune", "dune")).toBe(1);
    expect(similarityScore("The Hitchhiker's Guide", "the hitchhikers guide")).toBe(1);
  });

  it("is 0 when either side normalizes to nothing", () => {
    expect(similarityScore("", "Dune")).toBe(0);
    expect(similarityScore("!!!", "Dune")).toBe(0);
  });

  it("scores a partial overlap between 0 and 1", () => {
    const score = similarityScore("Children of Time", "Children of Ruin");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is symmetric", () => {
    expect(similarityScore("Children of Time", "Children of Ruin")).toBe(
      similarityScore("Children of Ruin", "Children of Time"),
    );
  });
});

describe("contentWordsMatch", () => {
  it("rejects a sibling in the same series despite a high Dice score", () => {
    // The case the gate was added for: "Children of Time" and "Children of
    // Ruin" share the series stem, so similarity alone would accept it.
    expect(similarityScore("Children of Time", "Children of Ruin")).toBeGreaterThan(0.5);
    expect(contentWordsMatch("Children of Time", "Children of Ruin")).toBe(false);
  });

  it("is one-directional: a candidate may add words", () => {
    expect(contentWordsMatch("Dune", "Dune Messiah")).toBe(true);
    expect(contentWordsMatch("Dune Messiah", "Dune")).toBe(false);
  });

  it("is why callers that must not accept a superset gate both ways", () => {
    // `titlesEquivalent` in filenameMatching.ts does exactly this, because
    // accepting "Dune" as "Dune Messiah" links the wrong book.
    const bothWays = (a: string, b: string) => contentWordsMatch(a, b) && contentWordsMatch(b, a);
    expect(bothWays("Dune", "Dune Messiah")).toBe(false);
    expect(bothWays("Dune", "dune")).toBe(true);
  });

  it("accepts anything when the search title is all stop words", () => {
    // Documented behaviour: there is nothing to gate on, so the gate abstains
    // and the caller's other signals (author, exact id) have to decide.
    expect(contentWordsMatch("The", "Dune")).toBe(true);
  });

  it("ignores punctuation and case differences", () => {
    expect(contentWordsMatch("The Hitchhiker's Guide", "the hitchhikers guide")).toBe(true);
  });
});
