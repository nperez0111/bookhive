/* tslint:disable */
/* eslint-disable */

/**
 * Inspect an ebook's metadata without converting it.
 *
 * `from` is the input format name (see [`convert`]). Returns a JSON string:
 * `{"title": ..., "authors": [...], "language": ..., "chapters": n, "toc_entries": n}`.
 * Call `JSON.parse` on the result in JavaScript.
 */
export function book_info(data: Uint8Array, from: string): any;

/**
 * Convert an ebook from one format to another.
 *
 * `from` and `to` are format names: `"epub"`, `"azw3"`, `"mobi"`, `"kfx"`,
 * or `"markdown"` (`"md"`). Any importable `from` (EPUB, AZW3, MOBI, KFX)
 * can be converted to any exportable `to` (EPUB, AZW3, KFX, Markdown).
 *
 * Takes the raw input bytes and returns the converted output bytes
 * (UTF-8 text for Markdown).
 */
export function convert(data: Uint8Array, from: string, to: string): Uint8Array;

/**
 * Initialize panic hook for better error messages in the browser console.
 */
export function init(): void;
