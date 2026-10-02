/**
 * Both directions of the `<input type="date">` ↔ ISO datetime conversion.
 *
 * They are a pair and were split across the codebase: the ISO→input direction
 * was open-coded at four call sites, while the input→ISO direction lived alone
 * inside `routes/api.tsx` — so the form path (`POST /books/`) never got the
 * noon-UTC treatment described below and stored a bare `YYYY-MM-DD`.
 */

/** A bare calendar date, as an `<input type="date">` emits it. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ISO datetime → the `value` of an `<input type="date">`. Empty for null.
 */
export function toDateInputValue(date: string | null | undefined): string {
  if (!date) return "";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/**
 * `<input type="date">` value → a full ISO datetime.
 *
 * A bare `YYYY-MM-DD` is anchored at **noon UTC** because that is the anchor
 * that preserves the calendar date across the most timezones: it holds from
 * UTC−12 to UTC+11 inclusive. It does *not* hold at UTC+12..+14 (Kiritimati,
 * Chatham, NZDT), where 12:00Z is already the next day — no single anchor can
 * cover a 26-hour offset span, and noon covers the most of it.
 * `src/core/bookLifecycle.test.ts` pins both halves of that. Anything already carrying a time
 * passes through untouched, and so does an impossible date like `2025-02-31`:
 * `Date.UTC` would silently roll it forward to March 3, so the raw value is
 * returned for the caller's `datetime()` check to reject.
 */
export function dateInputToISO(val: string): string {
  if (!val) return "";
  if (!DATE_ONLY.test(val)) return val;

  const [year, month, day] = val.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return val;
  }
  return parsed.toISOString();
}
