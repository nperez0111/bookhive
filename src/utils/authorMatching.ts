/**
 * Utilities for matching authors in tab-separated author strings.
 * Authors are stored as "Author1\tAuthor2\tAuthor3" in the database.
 */

const TAB = "\t";

/**
 * Builds SQL LIKE patterns for matching an author in a tab-separated string.
 * Returns the patterns needed to match an author in any position:
 * - Exact match (sole author)
 * - First author (followed by tab)
 * - Middle author (surrounded by tabs)
 * - Last author (preceded by tab)
 */
export function buildAuthorLikePatterns(author: string): {
  exact: string;
  first: string;
  middle: string;
  last: string;
} {
  return {
    exact: author,
    first: author + TAB + "%",
    middle: "%" + TAB + author + TAB + "%",
    last: "%" + TAB + author,
  };
}

/**
 * Splits a tab-separated authors string into an array of individual authors.
 */
export function parseAuthors(authorsString: string): string[] {
  return authorsString.split(TAB).filter((a) => a.length > 0);
}

/**
 * Joins an array of authors into a tab-separated string.
 */
export function formatAuthors(authors: string[]): string {
  return authors.join(TAB);
}

/**
 * Calculates pagination values.
 */
export function calculatePagination(
  totalItems: number,
  pageSize: number,
  currentPage: number,
): {
  totalPages: number;
  offset: number;
  validPage: number;
} {
  const validPage = Math.max(1, currentPage);
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (validPage - 1) * pageSize;

  return {
    totalPages,
    offset,
    validPage,
  };
}
