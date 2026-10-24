/** Only advance when the server consumed a full page and moved the offset. */
export function nextOffset(
  page: { books: unknown[]; offset?: number },
  requestedOffset: number,
  pageSize: number,
): number | undefined {
  if (page.books.length < pageSize) return undefined;
  const offset = page.offset ?? requestedOffset + page.books.length;
  return offset > requestedOffset ? offset : undefined;
}

/** A repeated cursor must not make onEndReached request the same page forever. */
export function nextFeedCursor(
  page: { cursor?: string; hasMore: boolean },
  consumedCursors: readonly string[],
): string | undefined {
  return page.hasMore && page.cursor && !consumedCursors.includes(page.cursor)
    ? page.cursor
    : undefined;
}

/** Offset pages can overlap as the catalogue changes. Keep the newest page-one copy. */
export function uniqueBooks<T extends { id: string }>(pages: readonly { books: T[] }[]): T[] {
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.books)
    .filter((book) => {
      if (seen.has(book.id)) return false;
      seen.add(book.id);
      return true;
    });
}
