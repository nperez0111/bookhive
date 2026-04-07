import { useState, type FC } from "hono/jsx/dom";

export const STATUS_OPTIONS = [
  { value: "buzz.bookhive.defs#finished", label: "Read" },
  { value: "buzz.bookhive.defs#reading", label: "Reading" },
  { value: "buzz.bookhive.defs#wantToRead", label: "Want to Read" },
  { value: "buzz.bookhive.defs#abandoned", label: "Abandoned" },
] as const;

export const STATUS_LABELS: Record<string, string> = {
  "buzz.bookhive.defs#finished": "read",
  "buzz.bookhive.defs#reading": "reading",
  "buzz.bookhive.defs#wantToRead": "want to read",
  "buzz.bookhive.defs#abandoned": "abandoned",
};

const selectClass =
  "w-full cursor-pointer rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none";

export async function updateBook(hiveId: string, fields: Record<string, unknown>) {
  try {
    await fetch("/api/update-book", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ hiveId, ...fields }),
    });
  } catch {}
}

export async function deleteBook(hiveId: string) {
  try {
    await fetch(`/books/${hiveId}`, {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
  } catch {}
}

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
    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
      <option key={val} value={val}>
        {"★".repeat(Math.floor(val / 2))}
        {val % 2 === 1 ? "½" : ""} {(val / 2).toFixed(1)}
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

export function toDateValue(date: string | null | undefined): string {
  return date ? new Date(date).toISOString().slice(0, 10) : "";
}

export const DateInput: FC<{
  value: string | null;
  onChange: (val: string) => void;
}> = ({ value, onChange }) => (
  <input
    type="date"
    className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-xs text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
    value={toDateValue(value)}
    onChange={(e) => onChange((e.target as HTMLInputElement).value)}
  />
);
