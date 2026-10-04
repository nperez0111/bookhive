import { useState, type FC } from "hono/jsx/dom";
import { BOOK_STATUS_MAP, BOOK_STATUS_OPTIONS } from "../../constants";
import { STARS_CHOICES, starsOptionLabel } from "../../core/rating";
import { toDateInputValue } from "../../lib/dateInput";
import { FallbackCover } from "../../pages/components/fallbackCover";

export const STATUS_OPTIONS = BOOK_STATUS_OPTIONS;

export const STATUS_LABELS: Record<string, string> = BOOK_STATUS_MAP;

const selectClass =
  "focus-ring min-h-10 w-full cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-sm";

export { writeBook as updateBook, deleteBook } from "./bookApi";

export const StatusSelect: FC<{
  status?: string | null;
  label?: string;
  onChange: (status: string) => void;
}> = ({ status, label = "Reading status", onChange }) => (
  <select
    className={selectClass}
    aria-label={label}
    value={status || ""}
    onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
  >
    <option value="" selected={!status}>
      Status
    </option>
    {STATUS_OPTIONS.map((s) => (
      <option key={s.value} value={s.value} selected={status === s.value}>
        {s.label}
      </option>
    ))}
  </select>
);

export const RatingSelect: FC<{
  stars?: number | null;
  label?: string;
  onChange: (stars: number) => void;
}> = ({ stars, label = "Rating", onChange }) => (
  <select
    className={selectClass}
    aria-label={label}
    value={stars ?? ""}
    onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value))}
  >
    <option value="" selected={stars == null}>
      Not rated
    </option>
    {STARS_CHOICES.map((val) => (
      <option key={val} value={val} selected={stars === val}>
        {starsOptionLabel(val)}
      </option>
    ))}
  </select>
);

export const DeleteButton: FC<{ onDelete: () => void }> = ({ onDelete }) => (
  <button
    type="button"
    // min-h-10/min-w-10 is the house tap-target floor; p-2 around a 16px icon
    // was a 32px hit area. The table row is ~73px tall (the stacked date
    // inputs set it), so the larger target costs no row height.
    className="focus-ring inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-destructive transition-[color,background-color] duration-150 hover:bg-destructive/10 hover:text-destructive/80"
    title="Delete book from library"
    onClick={onDelete}
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1H8a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  </button>
);

export const BookCover: FC<{ src?: string | null; alt?: string }> = ({ src, alt }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <FallbackCover className="h-full w-full" />;
  }
  return (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
};

export { toDateInputValue as toDateValue } from "../../lib/dateInput";

export const DateInput: FC<{
  value: string | null;
  onChange: (val: string) => void;
}> = ({ value, onChange }) => (
  <input
    type="date"
    className="focus-ring min-h-10 min-w-0 w-full rounded-md border border-border bg-card px-2 py-1 text-xs tabular-nums text-foreground shadow-sm"
    value={toDateInputValue(value)}
    onChange={(e) => onChange((e.target as HTMLInputElement).value)}
  />
);
