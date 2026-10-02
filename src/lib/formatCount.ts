/**
 * A book/author count, rounded down to a friendly bucket for a directory chip:
 * under 10 exact, then to tens, hundreds, and `Nk+` past a thousand.
 *
 * Rounding *down* is deliberate — the counts come from cached aggregates that
 * can lag the real table, and a chip that undersells is honest where one that
 * oversells is not.
 *
 * `/explore`, `/explore/genres` and `/explore/authors` each carried an
 * identical copy. They agreed on every branch and every boundary, which is
 * exactly why the next tweak to one of them would have gone unnoticed.
 */
export function formatCount(count: number): string {
  if (count < 10) return `${count}`;
  if (count < 100) return `${Math.floor(count / 10) * 10}+`;
  if (count >= 1000) return `${Math.floor(count / 1000)}k+`;
  return `${Math.floor(count / 100) * 100}+`;
}
