// Cover validation.
//
// A book can advertise a cover that is missing, undecodable (garbage bytes), or
// nonsensical (e.g. a 1x1 transparent placeholder). Any of those render as a
// blank box in the library grid, so we validate the extracted cover before
// storing it and fall back to a generated placeholder when it doesn't hold up.

/** Minimum width/height (px) for a cover to be considered "real". */
export const MIN_COVER_DIMENSION = 16;

/**
 * Largest cover we will decompress out of an archive. The ZIP central
 * directory tells us the decompressed size before we inflate anything, so this
 * is checked ahead of the work rather than after it — a book advertising a
 * 200 MB image as its cover simply doesn't get one.
 */
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

/**
 * Decode the cover header with Bun's native image pipeline and confirm it is a
 * real, sensibly-sized image. Never throws — returns false on any failure.
 */
export async function isUsableCover(bytes: Uint8Array | undefined | null): Promise<boolean> {
  if (!bytes || bytes.length === 0) return false;
  try {
    // metadata() reads the header only (no full pixel decode).
    const { width, height } = await new Bun.Image(bytes).metadata();
    return (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width >= MIN_COVER_DIMENSION &&
      height >= MIN_COVER_DIMENSION
    );
  } catch {
    return false;
  }
}
