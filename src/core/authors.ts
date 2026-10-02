/**
 * The one place that knows how an authors list is encoded.
 *
 * `hive_book.authors` and `user_book.authors` hold a **tab-separated** list;
 * splitting drops empty segments so callers agree on how `"A\t\tB"` renders.
 *
 * Three separators are in play across the app and are not interchangeable:
 * **tab** here, **comma** in `personal_book.authors` (`parseBook`), and
 * **newline** in a KOReader metadata payload (`doc_props.authors`).
 */

const TAB = "\t";

/**
 * Splits a stored authors string into individual authors.
 *
 * Segments are **trimmed and empties dropped**, matching migration 020's
 * `trim(substr(...))` trigger for `hive_book_author` — an untrimmed split
 * disagrees with it and yields an `/authors/` link that matches no rows.
 */
export function parseAuthors(authorsString: string | null | undefined): string[] {
  return (authorsString ?? "")
    .split(TAB)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/** Joins authors back into the stored tab-separated encoding. */
export function formatAuthors(authors: readonly string[]): string {
  return authors.join(TAB);
}

/**
 * Renders a stored authors string for a human: "Ann Leckie, Becky Chambers".
 * Use this anywhere authors reach a template — never `split("\t").join(", ")`.
 */
export function displayAuthors(authorsString: string | null | undefined): string {
  return parseAuthors(authorsString).join(", ");
}

/** The credited first author, or `""` when there is none. */
export function primaryAuthor(authorsString: string | null | undefined): string {
  return parseAuthors(authorsString)[0] ?? "";
}
