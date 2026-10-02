/**
 * Offset pagination arithmetic, in one place.
 *
 * This lived in `authorMatching.ts` — nothing to do with authors — where no
 * production code ever imported it, only its own test. Meanwhile six call
 * sites re-derived `Math.ceil(total / pageSize)` by hand and three of them
 * remembered the `Math.max(1, …)` floor that keeps a `?page=0` or `?page=-3`
 * from producing a negative OFFSET.
 */

export type Pagination = {
  /** Total number of pages; at least 1, so "page 1 of 0" is not renderable. */
  totalPages: number;
  /** SQL OFFSET for `validPage`. */
  offset: number;
  /** The requested page clamped into `1..totalPages`. */
  validPage: number;
};

export function calculatePagination(
  totalItems: number,
  pageSize: number,
  currentPage: number,
): Pagination {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.min(Math.max(1, Math.floor(currentPage) || 1), totalPages);
  return { totalPages, offset: (validPage - 1) * pageSize, validPage };
}

/**
 * OFFSET for a requested page when the total isn't known yet — the page
 * templates fire the count and the data query in parallel, so the offset has to
 * be chosen before `calculatePagination` can clamp against `totalPages`.
 */
export function pageOffset(currentPage: number, pageSize: number): number {
  return (Math.max(1, Math.floor(currentPage) || 1) - 1) * pageSize;
}

/**
 * The window of page numbers a pager renders, at most `size` wide and pinned to
 * the ends of the range. All three page templates carried this same
 * four-branch `if/else` chain inline.
 */
export function pageWindow(currentPage: number, totalPages: number, size = 5): number[] {
  const length = Math.min(size, totalPages);
  const half = Math.floor(size / 2);
  let start = 1;
  if (totalPages > size) {
    start = Math.min(Math.max(currentPage - half, 1), totalPages - size + 1);
  }
  return Array.from({ length }, (_, i) => start + i);
}
