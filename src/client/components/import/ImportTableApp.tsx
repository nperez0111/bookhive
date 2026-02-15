import { useEffect, useMemo, useState, type FC } from "hono/jsx/dom";

import { BOOK_STATUS_MAP } from "../../../constants";
import { StarRating } from "../StarRating";
import type {
  ImportEvent,
  ImportRow,
  BookUploadEvent,
  BookFailedEvent,
} from "./types";

const STORAGE_KEY = "bookhive_import_results";

const StatusBadge: FC<{ success: boolean }> = ({ success }) => (
  <span
    className={
      "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium " +
      (success
        ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300")
    }
  >
    {success ? "Success" : "Failed"}
  </span>
);

const FailedRow: FC<{
  row: {
    title: string;
    author: string;
    isbn10?: string;
    isbn13?: string;
    status?: string;
    finishedAt?: string;
    stars?: number;
    review?: string;
    reason?: string;
  };
  onResolved: (
    success: Extract<ImportRow, { success: true }>,
    failedKey: string,
  ) => void;
}> = ({ row, onResolved }) => {
  const getReasonText = (reason?: string): string | null => {
    if (!reason || reason === "no_match") return null;
    switch (reason) {
      case "processing_error":
        return "Processing error";
      case "update_error":
        return "Update error";
      default:
        return reason;
    }
  };
  const reasonText = getReasonText(row.reason);
  const query = encodeURIComponent(`${row.title} ${row.author}`);
  const [isOpen, setOpen] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/xrpc/buzz.bookhive.searchBooks?q=${query}&limit=20`,
      );
      const data = await res.json();
      const results = Array.isArray(data) ? data : (data?.books ?? []);
      if (!results.length) {
        const res = await fetch(
          `/xrpc/buzz.bookhive.searchBooks?q=${encodeURIComponent(`${row.title}`)}&limit=20`,
        );
        const data = await res.json();
        return setResults(Array.isArray(data) ? data : (data?.books ?? []));
      }
      setResults(results);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const resolveImport = async (hiveId: string) => {
    try {
      // Reuse existing update endpoint to upsert the book with parsed CSV details
      const res = await fetch("/api/update-book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          hiveId,
          title: row.title,
          authors: row.author,
          status: row.status,
          finishedAt: row.finishedAt,
          stars: row.stars,
          review: row.review,
        }),
      });
      if (!res.ok) return;
      const bookRes = await fetch(
        `/xrpc/buzz.bookhive.searchBooks?id=${hiveId}&limit=1`,
      );
      const data = await bookRes.json();
      const arr = Array.isArray(data) ? data : (data?.books ?? []);
      const b = arr[0] ?? null;
      if (b) {
        onResolved(
          {
            success: true,
            hiveId: b.id,
            title: b.title,
            authors: b.authors,
            coverImage: b.cover ?? b.thumbnail ?? undefined,
          } as any,
          `${row.title}::${row.author}`,
        );
        setOpen(false);
      } else {
        // Even if we can't fetch display details, remove the failed row so user isn't blocked
        onResolved(
          {
            success: true,
            hiveId,
            title: row.title,
            authors: row.author,
          } as any,
          `${row.title}::${row.author}`,
        );
        setOpen(false);
      }
    } catch {}
  };

  return (
    <tr>
      <td className="px-4 py-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <StatusBadge success={false} />
              <div className="text-sm">
                <div className="font-medium text-gray-900 dark:text-white">
                  {row.title}
                </div>
                <div className="text-gray-600 dark:text-gray-300">
                  {row.author}
                </div>
                {reasonText && (
                  <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {reasonText}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-gray-800 hover:bg-gray-200 dark:bg-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-600"
              onClick={() => {
                setOpen((v) => !v);
                if (!isOpen) search();
              }}
            >
              Match book
            </button>
          </div>
          {isOpen && (
            <div className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
              {loading ? (
                <div className="px-2 py-1 text-sm text-gray-600 dark:text-gray-300">
                  Searching…
                </div>
              ) : results.length === 0 ? (
                <div className="px-2 py-1 text-sm text-gray-600 dark:text-gray-300">
                  No results
                </div>
              ) : (
                <ul className="space-y-2">
                  {results.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-yellow-50 dark:hover:bg-zinc-800"
                    >
                      <div className="flex items-center gap-3">
                        {b.thumbnail && (
                          <img
                            src={b.thumbnail}
                            className="h-10 w-7 rounded object-cover"
                          />
                        )}
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {b.title}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            {(b.authors || "").split("\t").join(", ")}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={`/books/${b.id}`}
                          className="cursor-pointer text-sm text-yellow-700 hover:underline dark:text-yellow-400"
                        >
                          View
                        </a>
                        <button
                          type="button"
                          className="cursor-pointer rounded-md bg-yellow-600 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-yellow-700"
                          onClick={() => resolveImport(b.id)}
                        >
                          Use this
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

const StatusDropdown: FC<{
  status?: string;
  onChange: (status: string) => void;
}> = ({ status, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const items = useMemo(
    () => [
      { value: "buzz.bookhive.defs#finished", label: "Read" },
      { value: "buzz.bookhive.defs#reading", label: "Reading" },
      { value: "buzz.bookhive.defs#wantToRead", label: "Want to Read" },
      { value: "buzz.bookhive.defs#abandoned", label: "Abandoned" },
    ],
    [],
  );
  const selectedLabel = status
    ? BOOK_STATUS_MAP[status as keyof typeof BOOK_STATUS_MAP] || status
    : "Add to shelf";
  return (
    <div className="relative w-full min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
        className="peer w-full cursor-pointer rounded-md bg-white px-3 py-2 text-left text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-300 ring-inset hover:bg-zinc-50 focus:ring-2 focus:ring-yellow-600 focus:outline-none dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-900"
      >
        <span className="flex items-center justify-between capitalize">
          <span className="truncate">{selectedLabel}</span>
          <svg
            className="h-5 w-5 flex-shrink-0 text-gray-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clip-rule="evenodd"
            />
          </svg>
        </span>
      </button>
      {isOpen && (
        <div
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded-md bg-yellow-50 shadow-lg ring-1 ring-black/5 dark:bg-zinc-800"
        >
          <div className="p-1">
            {items.map((item) => (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={status === item.value}
                onClick={() => {
                  onChange(item.value);
                  setIsOpen(false);
                }}
                className={`relative my-1 w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm ${
                  status === item.value
                    ? "bg-yellow-900 text-white"
                    : "text-gray-900 hover:bg-zinc-50 dark:text-white dark:hover:bg-zinc-700"
                }`}
              >
                <span className="block truncate">{item.label}</span>
                {status === item.value && (
                  <span
                    className="absolute inset-y-0 right-2 flex items-center"
                    aria-hidden="true"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SuccessRowView: FC<{
  row: Extract<ImportRow, { success: true }>;
  onUpdate: (next: Partial<ImportRow>) => void;
  onDelete: (hiveId: string) => void;
}> = ({ row, onUpdate, onDelete }) => {
  const { hiveId, title, authors, coverImage, stars, status } = row;
  return (
    <tr>
      <td className="px-4 py-2">
        <div className="flex items-center space-x-3">
          <div className="h-12 w-8 flex-shrink-0 overflow-hidden rounded-md">
            {coverImage ? (
              <img
                src={coverImage}
                alt={`Cover of ${title}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-yellow-100 to-yellow-200 dark:from-zinc-600 dark:to-zinc-700" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusBadge success={true} />
              <a
                href={`/books/${hiveId}`}
                className="text-sm font-medium text-gray-900 hover:underline dark:text-white"
              >
                {title}
              </a>
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
        {authors.split("\t").join(", ")}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center space-x-1">
          <StarRating
            initialRating={stars || 0}
            onChange={async (rating) => {
              onUpdate({ stars: rating });
              try {
                await fetch("/api/update-book", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    accept: "application/json",
                  },
                  body: JSON.stringify({ hiveId, stars: rating }),
                });
              } catch {}
            }}
          />
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <StatusDropdown
              status={status}
              onChange={async (nextStatus) => {
                onUpdate({ status: nextStatus });
                try {
                  await fetch("/api/update-book", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      accept: "application/json",
                    },
                    body: JSON.stringify({ hiveId, status: nextStatus }),
                  });
                } catch {}
              }}
            />
          </div>
          <button
            type="button"
            className="inline-flex items-center rounded-md p-2 text-red-600 hover:bg-red-50 hover:text-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
            title="Delete book from library"
            onClick={async () => {
              onDelete(hiveId);
              try {
                await fetch(`/books/${hiveId}`, {
                  method: "DELETE",
                  headers: { accept: "application/json" },
                });
              } catch {}
            }}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1H8a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
};

export const ImportTableApp: FC = () => {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    message?: string;
  } | null>(null);
  // complete flag not currently used for UI; progress presence is enough

  // load from storage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setRows(JSON.parse(raw));
    } catch {}
  }, []);

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {}
  }, [rows]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<ImportEvent>;
      const data = ce.detail;
      if (!data) return;
      switch (data.event) {
        case "import-start": {
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {}
          setRows([]);
          setProgress({ current: 0, total: 0, message: "Starting import..." });
          break;
        }
        case "upload-start": {
          const sp = data.stageProgress as any;
          if (sp)
            setProgress({
              current: sp.current || 0,
              total: sp.total || 0,
              message: sp.message,
            });
          break;
        }
        case "book-upload": {
          const ev = data as BookUploadEvent;
          setProgress({
            current: ev.processed,
            total: ev.total,
            message: ev.stageProgress?.message,
          });
          if (ev.book) {
            setRows((prev) => {
              const next = prev.some(
                (r) => r.success && r.hiveId === ev.book.hiveId,
              )
                ? prev
                : prev.concat([{ success: true, ...ev.book }]);
              return next;
            });
          }
          break;
        }
        case "book-failed": {
          const ev = data as BookFailedEvent;
          setRows((prev) => {
            const exists = prev.some(
              (r) =>
                !r.success &&
                r.title === ev.failedBook.title &&
                r.author === ev.failedBook.author,
            );
            return exists
              ? prev
              : prev.concat([{ success: false, ...ev.failedBook }]);
          });
          break;
        }
        case "import-complete": {
          const sp = data.stageProgress as any;
          if (sp)
            setProgress({
              current: sp.current || 0,
              total: sp.total || 0,
              message: sp.message,
            });
          break;
        }
      }
    };
    window.addEventListener("bookhive:import-event" as any, handler);
    return () =>
      window.removeEventListener("bookhive:import-event" as any, handler);
  }, []);

  const updateRow = (hiveId: string, next: Partial<ImportRow>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.success && r.hiveId === hiveId ? ({ ...r, ...next } as ImportRow) : r,
      ),
    );
  };
  const deleteRow = (hiveId: string) => {
    setRows((prev) => prev.filter((r) => !(r.success && r.hiveId === hiveId)));
  };

  const successRows = useMemo(
    () =>
      rows
        .filter((r) => r.success)
        .sort((a, b) =>
          (a as any).title.localeCompare((b as any).title, undefined, {
            sensitivity: "base",
          }),
        ),
    [rows],
  );
  const failedRows = useMemo(
    () =>
      rows
        .filter((r) => !r.success)
        .sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
        ),
    [rows],
  );

  const alreadyCount = (successRows as any[]).filter(
    (r) => r.alreadyExists,
  ).length;

  return (
    <div className="mt-8">
      {/* Summary */}
      {(rows.length > 0 || progress) && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-zinc-800">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Imported
            </div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-white">
              {successRows.length}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-zinc-800">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Failed
            </div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-white">
              {failedRows.length}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-zinc-800">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Already in library
            </div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-white">
              {alreadyCount}
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Imported books</h3>
        <div className="flex items-center gap-2">
          {progress && (
            <div className="w-56">
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  {progress.message || "Importing..."}
                </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {progress.total - progress.current}/{progress.total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-zinc-700">
                <div
                  className="h-2 rounded-full bg-yellow-500 transition-all duration-300"
                  style={{
                    width: `${progress.total ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          <button
            type="button"
            className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-200 dark:bg-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-600"
            onClick={() => setRows([])}
          >
            Clear list
          </button>
        </div>
      </div>

      {/* Failed table - moved above for visibility */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-zinc-800">
        <div className="border-b border-gray-200 px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
          Failed imports
        </div>
        <table className="w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="sticky top-0 z-10 bg-yellow-50 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Book
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-zinc-800">
            {failedRows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-gray-600 dark:text-gray-300">
                  No failed books
                </td>
              </tr>
            )}
            {failedRows.map((row) => (
              <FailedRow
                key={`${row.title}-${row.author}`}
                row={row}
                onResolved={(success, failedKey) => {
                  const normalize = (s: string) =>
                    s
                      ?.normalize("NFKC")
                      .toLowerCase()
                      .replace(/\s+/g, " ")
                      .trim();
                  const [fkTitle, fkAuthor] = failedKey.split("::");
                  const failedKeyNorm = `${normalize(fkTitle)}::${normalize(fkAuthor)}`;

                  setRows((prev) => {
                    const next = prev
                      .filter((r) => {
                        const isFailed = !(r as any).success;
                        if (!isFailed) return true;
                        const rt = normalize((r as any).title || "");
                        const ra = normalize((r as any).author || "");
                        return `${rt}::${ra}` !== failedKeyNorm;
                      })
                      .concat([success as any]);
                    try {
                      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
                    } catch {}
                    return next;
                  });
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Successful table */}
      <div className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-zinc-800">
        <table className="w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="sticky top-0 z-10 bg-yellow-50 dark:bg-zinc-900">
            <tr>
              <th
                className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white"
                style="width: 60%"
              >
                Book
              </th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Rating
              </th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Status
              </th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-zinc-800">
            {successRows.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-gray-600 dark:text-gray-300"
                >
                  Imported books will appear here as they are processed.
                </td>
              </tr>
            )}
            {successRows.map((row) => (
              <SuccessRowView
                key={(row as any).hiveId}
                row={row}
                onUpdate={(next: Partial<ImportRow>) => {
                  if (row.success) updateRow(row.hiveId, next);
                }}
                onDelete={(hiveId: string) => deleteRow(hiveId)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
