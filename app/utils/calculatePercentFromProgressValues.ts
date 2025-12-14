export function calculatePercentFromProgressValues({
  currentPage,
  totalPages,
  currentChapter,
  totalChapters,
}: {
  currentPage?: number | null;
  totalPages?: number | null;
  currentChapter?: number | null;
  totalChapters?: number | null;
}): number | null {
  if (
    typeof currentPage === "number" &&
    typeof totalPages === "number" &&
    totalPages > 0
  ) {
    return Math.min(
      100,
      Math.max(0, Math.round((currentPage / totalPages) * 100)),
    );
  }

  if (
    typeof currentChapter === "number" &&
    typeof totalChapters === "number" &&
    totalChapters > 0
  ) {
    return Math.min(
      100,
      Math.max(0, Math.round((currentChapter / totalChapters) * 100)),
    );
  }

  return null;
}
