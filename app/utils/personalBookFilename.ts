/** Keep the upload's name (not the linked catalogue title), including its extension. */
export function personalBookFilename(book: { filename?: string; format: string }): string {
  const name = (book.filename ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (name && name !== "." && name !== "..") return name;
  const extension = book.format.replace(/[^a-z0-9.]/gi, "") || "epub";
  return `book.${extension}`;
}

/** The server may serve a derived EPUB for MOBI/AZW uploads. Its UTF-8
 * disposition preserves the intrinsic stem while correcting that extension. */
export function downloadedBookFilename(
  book: { filename?: string; format: string },
  disposition?: string | null,
): string {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return personalBookFilename({ ...book, filename: decodeURIComponent(encoded.trim()) });
    } catch {
      /* Keep the intrinsic upload filename if the header is malformed. */
    }
  }
  return personalBookFilename(book);
}
