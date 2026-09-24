/**
 * The one place that knows the three rating scales in this app.
 *
 * Everything a human sees is on a **0–5** scale, but neither column is stored
 * that way:
 *
 * - `user_book.stars` — the viewer's own rating, an integer **1–10**, so that
 *   half a display star is representable without a float.
 * - `hive_book.rating` — the community average, **×1000** (4520 = 4.52 / 5), so
 *   that it too is an integer. `authorStats` already divides in SQL, so an
 *   `avgRating` coming out of that helper is a display rating and must not be
 *   divided again.
 *
 * `StarDisplay` takes a display rating — convert at the edge with these
 * helpers rather than leaving each caller to remember which scale it has.
 */

/** `user_book.stars` per whole display star. */
export const STARS_PER_DISPLAY_STAR = 2;

/** `hive_book.rating` units per display point. */
export const HIVE_RATING_SCALE = 1000;

/** Highest display rating; both scales are anchored to it. */
export const MAX_DISPLAY_RATING = 5;

/** `user_book.stars` (1–10) → display rating (0.5–5). Null passes through. */
export function starsToDisplayRating(stars: number | null | undefined): number | null {
  return stars == null ? null : stars / STARS_PER_DISPLAY_STAR;
}

/** Display rating (0–5) → `user_book.stars` (0–10), for a write. */
export function displayRatingToStars(rating: number): number {
  return Math.round(rating * STARS_PER_DISPLAY_STAR);
}

/** `hive_book.rating` (0–5000) → display rating (0–5). Null passes through. */
export function hiveRatingToDisplayRating(rating: number | null | undefined): number | null {
  return rating == null ? null : rating / HIVE_RATING_SCALE;
}

/** Display rating (0–5) → `hive_book.rating`, for an enrichment write. */
export function displayRatingToHiveRating(rating: number): number {
  return Math.round(rating * HIVE_RATING_SCALE);
}

/**
 * Whole stars for a text rendering like "★★★½". `StarDisplay` clips a partial
 * star instead and should be preferred wherever markup is allowed.
 */
export function displayRatingParts(rating: number): { full: number; half: boolean } {
  return { full: Math.floor(rating), half: rating % 1 >= 0.5 };
}

/** Every selectable `user_book.stars` value, lowest first. */
export const STARS_CHOICES: readonly number[] = Array.from(
  { length: MAX_DISPLAY_RATING * STARS_PER_DISPLAY_STAR },
  (_, i) => i + 1,
);

/**
 * A display rating as text: `"★★★½"`. For contexts that can't take markup;
 * `StarDisplay` clips a real partial star and is preferred where it can be used.
 */
export function displayRatingGlyphs(rating: number): string {
  const { full, half } = displayRatingParts(rating);
  return `${"★".repeat(full)}${half ? "½" : ""}`;
}

/** Same, straight from `user_book.stars`. */
export function starsGlyphs(stars: number | null | undefined): string {
  const rating = starsToDisplayRating(stars);
  return rating == null ? "" : displayRatingGlyphs(rating);
}

/** Label for one entry of a stars picker: `"★★★½ 3.5"`. */
export function starsOptionLabel(stars: number): string {
  const rating = stars / STARS_PER_DISPLAY_STAR;
  return `${displayRatingGlyphs(rating)} ${rating.toFixed(1)}`;
}
