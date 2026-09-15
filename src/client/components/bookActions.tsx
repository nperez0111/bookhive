import { useState, type FC } from "hono/jsx/dom";
import { BOOK_STATUS_MAP, BOOK_STATUS_OPTIONS } from "../../constants";
import { STARS_CHOICES, starsOptionLabel } from "../../core/rating";
import { toDateInputValue } from "../../lib/dateInput";

export const STATUS_OPTIONS = BOOK_STATUS_OPTIONS;

export const STATUS_LABELS: Record<string, string> = BOOK_STATUS_MAP;

const selectClass =
  "w-full cursor-pointer rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none";

export { writeBook as updateBook, deleteBook } from "./bookApi";

export const StatusSelect: FC<{
  status?: string | null;
  onChange: (status: string) => void;
}> = ({ status, onChange }) => (
  <select
    className={selectClass}
    value={status || ""}
    onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
  >
    <option value="">Status</option>
    {STATUS_OPTIONS.map((s) => (
      <option key={s.value} value={s.value}>
        {s.label}
      </option>
    ))}
  </select>
);

export const RatingSelect: FC<{
  stars?: number | null;
  onChange: (stars: number) => void;
}> = ({ stars, onChange }) => (
  <select
    className={selectClass}
    value={stars ?? ""}
    onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value))}
  >
    <option value="">-</option>
    {STARS_CHOICES.map((val) => (
      <option key={val} value={val}>
        {starsOptionLabel(val)}
      </option>
    ))}
  </select>
);

export const DeleteButton: FC<{ onDelete: () => void }> = ({ onDelete }) => (
  <button
    type="button"
    className="inline-flex items-center rounded-md p-2 text-red-600 hover:bg-red-50 hover:text-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
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
    return <div className="flex h-full w-full items-center justify-center bg-muted" />;
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
    className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
    value={toDateInputValue(value)}
    onChange={(e) => onChange((e.target as HTMLInputElement).value)}
  />
);
