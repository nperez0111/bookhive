import { describe, it, test, expect } from "bun:test";
import {
  displayRatingParts,
  starsToDisplayRating,
  displayRatingToStars,
  hiveRatingToDisplayRating,
  displayRatingToHiveRating,
  displayRatingGlyphs,
  starsGlyphs,
  starsOptionLabel,
  STARS_CHOICES,
  MAX_DISPLAY_RATING,
} from "./rating";

describe("stars (user_book.stars, 1-10) ↔ display (0-5)", () => {
  it("halves", () => {
    expect(starsToDisplayRating(10)).toBe(5);
    expect(starsToDisplayRating(7)).toBe(3.5);
    expect(starsToDisplayRating(1)).toBe(0.5);
  });

  // `?? 0` at a call site is only correct if null really means "unrated" —
  // it must not collapse to 0 here, or an unrated book renders as zero stars
  // where it should render none.
  it("passes null through rather than defaulting", () => {
    expect(starsToDisplayRating(null)).toBeNull();
    expect(starsToDisplayRating(undefined)).toBeNull();
  });

  it("round-trips every selectable value", () => {
    for (const stars of STARS_CHOICES) {
      expect(displayRatingToStars(starsToDisplayRating(stars)!)).toBe(stars);
    }
  });

  it("offers exactly the half-stars of a 5-star scale", () => {
    expect(STARS_CHOICES).toHaveLength(MAX_DISPLAY_RATING * 2);
    expect(STARS_CHOICES[0]).toBe(1);
    expect(STARS_CHOICES.at(-1)).toBe(MAX_DISPLAY_RATING * 2);
  });
});

describe("hive rating (hive_book.rating, 0-5000) ↔ display (0-5)", () => {
  it("divides by 1000", () => {
    expect(hiveRatingToDisplayRating(4520)).toBe(4.52);
    expect(hiveRatingToDisplayRating(0)).toBe(0);
  });

  it("passes null through", () => {
    expect(hiveRatingToDisplayRating(null)).toBeNull();
  });

  it("round-trips", () => {
    expect(displayRatingToHiveRating(hiveRatingToDisplayRating(4520)!)).toBe(4520);
  });

  // The two scales are three orders of magnitude apart, so mixing them up is
  // not a rounding error — it renders a 4.5-star book as 4500 stars.
  it("is not interchangeable with the stars scale", () => {
    expect(hiveRatingToDisplayRating(8)).not.toBe(starsToDisplayRating(8));
  });
});

describe("glyphs", () => {
  it("renders whole and half stars", () => {
    expect(displayRatingGlyphs(3)).toBe("★★★");
    expect(displayRatingGlyphs(3.5)).toBe("★★★½");
    expect(displayRatingGlyphs(0)).toBe("");
  });

  it("renders straight from stars", () => {
    expect(starsGlyphs(7)).toBe("★★★½");
    expect(starsGlyphs(null)).toBe("");
  });

  it("labels a picker entry", () => {
    expect(starsOptionLabel(7)).toBe("★★★½ 3.5");
    expect(starsOptionLabel(10)).toBe("★★★★★ 5.0");
  });
});

/**
 * `displayRatingParts` feeds the text star renderings. The half-star test is a
 * float comparison against values produced by `stars / 2`, so the boundary is
 * asserted explicitly rather than by inspection.
 */
describe("displayRatingParts", () => {
  test("exactly .5 is a half star", () => {
    expect(displayRatingParts(3.5)).toEqual({ full: 3, half: true });
  });

  test("just under .5 is not", () => {
    expect(displayRatingParts(3.4)).toEqual({ full: 3, half: false });
    expect(displayRatingParts(3.49999)).toEqual({ full: 3, half: false });
  });

  test("above .5 still shows one half star, not a second full one", () => {
    expect(displayRatingParts(3.9)).toEqual({ full: 3, half: true });
  });

  test("the ends of the scale", () => {
    expect(displayRatingParts(0)).toEqual({ full: 0, half: false });
    expect(displayRatingParts(5)).toEqual({ full: 5, half: false });
  });

  test("every odd `stars` value lands on a half star", () => {
    // `stars` is 1-10; the odd ones are the half-star ratings, and `stars / 2`
    // is where the float actually comes from.
    for (const stars of [1, 3, 5, 7, 9]) {
      expect(displayRatingParts(stars / 2).half).toBe(true);
    }
    for (const stars of [2, 4, 6, 8, 10]) {
      expect(displayRatingParts(stars / 2).half).toBe(false);
    }
  });
});
