import { useEffect, useMemo, useState, type FC } from "hono/jsx/dom";

import { BOOK_STATUS_MAP } from "../../../constants";
import { displayAuthors } from "../../../core/authors";
import { starsGlyphs } from "../../../core/rating";
import {
  StatusSelect,
  RatingSelect,
  DeleteButton,
  BookCover,
  updateBook as updateBookApi,
  deleteBook as deleteBookApi,
} from "../bookActions";
import type {
  ImportEvent,
  ImportRow,
  BookLoadEvent,
  BookUploadEvent,
  BookFailedEvent,
  ImportErrorEvent,
} from "./types";
import { Spinner } from "../../../pages/components/icons";
import { writeBook } from "../bookApi";

const STORAGE_KEY = "bookhive_import_results";

// --- Failed row with manual matching ---

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
  onResolved: (success: Extract<ImportRow, { success: true }>, failedKey: string) => void;
}> = ({ row, onResolved }) => {
  const getReasonText = (reason?: string): string | null => {
    if (!reason || reason === "no_match") return null;
    switch (reason) {
      case "processing_error":
        return "Processing error";
      case "update_error":
        return "Upload error";
      default:
        return reason;
    }
  };
  const reasonText = getReasonText(row.reason);
  const query = encodeURIComponent(`${row.title} ${row.author}`);
  const [isOpen, setOpen] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // `res.ok` matters here because the empty case has its own UI — without it a 5xx would tell the user "No results" for a search the server never ran.
  const searchOnce = async (q: string): Promise<any[]> => {
    const res = await fetch(`/xrpc/buzz.bookhive.searchBooks?q=${q}&limit=20`);
    if (!res.ok) throw new Error(`search failed (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data?.books ?? []);
  };

  const search = async () => {
    setLoading(true);
    setFailed(false);
    try {
      let found = await searchOnce(query);
      // Retry on title alone — an author the catalogue spells differently is
      // the common miss.
      if (!found.length) found = await searchOnce(encodeURIComponent(row.title));
      setResults(found);
    } catch {
      setResults([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const resolveImport = async (hiveId: string) => {
    try {
      const res = await writeBook(hiveId, {
        title: row.title,
        authors: row.author,
        status: row.status,
        finishedAt: row.finishedAt,
        stars: row.stars,
        review: row.review,
      });
      if (!res.ok) return;
      // The write has landed. This second call only fetches the catalogue's cover and canonical spelling, so its failure must not lose the match.
      let b: any = null;
      try {
        const bookRes = await fetch(`/xrpc/buzz.bookhive.searchBooks?id=${hiveId}&limit=1`);
        if (bookRes.ok) {
          const data = await bookRes.json();
          const arr = Array.isArray(data) ? data : (data?.books ?? []);
          b = arr[0] ?? null;
        }
      } catch {
        b = null;
      }
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
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">{row.title}</div>
          <div className="text-xs text-muted-foreground truncate">{row.author}</div>
          {reasonText && <div className="mt-0.5 text-xs text-destructive">{reasonText}</div>}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm shrink-0 whitespace-nowrap"
          onClick={() => {
            setOpen((v) => !v);
            if (!isOpen) void search();
          }}
        >
          Match book
        </button>
      </div>
      {isOpen && (
        <div className="mt-2 rounded-md border border-border bg-card p-2">
          {loading ? (
            <div className="px-2 py-1 text-sm text-muted-foreground">Searching…</div>
          ) : failed ? (
            <div className="px-2 py-1 text-sm text-destructive">Search failed. Try again.</div>
          ) : results.length === 0 ? (
            <div className="px-2 py-1 text-sm text-muted-foreground">No results</div>
          ) : (
            <ul className="space-y-2">
              {results.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {b.thumbnail && (
                      <img
                        src={b.thumbnail}
                        className="h-10 w-7 rounded object-cover shrink-0"
                        loading="lazy"
                        alt=""
                      />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{b.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {displayAuthors(b.authors)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={`/books/${b.id}`} className="text-sm text-primary hover:underline">
                      View
                    </a>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm whitespace-nowrap"
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
  );
};

// --- Success row: same layout as the library table on /profile ---

const SuccessRow: FC<{
  row: Extract<ImportRow, { success: true }>;
  onUpdate: (next: Partial<ImportRow>) => void;
  onDelete: (hiveId: string) => void;
}> = ({ row, onUpdate, onDelete }) => {
  const { hiveId, title, authors, coverImage, stars, status } = row;
  return (
    <tr
      className="cursor-pointer transition-colors duration-150 hover:bg-muted/60"
      onClick={() => (window.location.href = `/books/${hiveId}`)}
    >
      <td className="overflow-hidden px-4 py-2">
        <div className="flex items-center space-x-3">
          <div className="h-12 w-8 shrink-0 overflow-hidden rounded-md">
            <BookCover src={coverImage} alt={`Cover of ${title}`} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-1 text-sm leading-tight font-medium text-foreground">
              {title}
            </h3>
            <p className="line-clamp-1 text-xs text-muted-foreground">{displayAuthors(authors)}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        <StatusSelect
          status={status}
          onChange={(nextStatus) => {
            onUpdate({ status: nextStatus });
            void updateBookApi(hiveId, { status: nextStatus });
          }}
        />
      </td>
      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        <RatingSelect
          stars={stars}
          onChange={(rating) => {
            onUpdate({ stars: rating });
            void updateBookApi(hiveId, { stars: rating });
          }}
        />
      </td>
      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        <DeleteButton
          onDelete={() => {
            onDelete(hiveId);
            void deleteBookApi(hiveId);
          }}
        />
      </td>
    </tr>
  );
};

// --- Mobile card for success rows ---

const SuccessCard: FC<{
  row: Extract<ImportRow, { success: true }>;
  onUpdate: (next: Partial<ImportRow>) => void;
  onDelete: (hiveId: string) => void;
}> = ({ row }) => {
  const { hiveId, title, authors, coverImage, stars, status } = row;
  return (
    <a
      href={`/books/${hiveId}`}
      className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/60 transition-colors"
    >
      <div className="h-12 w-8 shrink-0 overflow-hidden rounded-md">
        <BookCover src={coverImage} alt={`Cover of ${title}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-sm font-medium text-foreground">{title}</div>
        <div className="line-clamp-1 text-xs text-muted-foreground">{displayAuthors(authors)}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {status && (
            <span className="capitalize">
              {BOOK_STATUS_MAP[status as keyof typeof BOOK_STATUS_MAP] || status}
            </span>
          )}
          {stars && (
            <span>
              {starsGlyphs(stars)}
              {stars % 2 === 1 ? "½" : ""}
            </span>
          )}
        </div>
      </div>
    </a>
  );
};

const normalizeStr = (s: string) =>
  (s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

// --- Progress display ---

export type ProgressState = {
  stage: "starting" | "matching" | "saving" | "complete" | "error";
  current: number;
  total: number;
  message?: string;
  bookTitle?: string;
  bookAuthor?: string;
  shareText?: string;
  uploadedCount?: number;
};

/** Batch errors are recoverable; only an explicit terminal stage ends the import. */
export function progressAfterImportError(
  previous: ProgressState | null,
  error: ImportErrorEvent,
): ProgressState | null {
  if (error.stage !== "error") return previous;
  return {
    stage: "error",
    current: previous?.current ?? 0,
    total: previous?.total ?? 0,
    uploadedCount: previous?.uploadedCount ?? 0,
    message: error.error,
  };
}

export const ProgressCard: FC<{ progress: ProgressState; onImportMore: () => void }> = ({
  progress,
  onImportMore,
}) => {
  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;
  const isComplete = progress.stage === "complete";
  const isError = progress.stage === "error";

  const stageLabel = {
    starting: "Starting import...",
    matching: "Matching books...",
    saving: "Saving to library...",
    complete: "Import complete!",
    error: "Import failed",
  }[progress.stage];

  return (
    <div
      className={
        isComplete
          ? "rounded-xl border border-primary/30 bg-primary p-6 shadow-sm"
          : isError
            ? "card border-destructive/30"
            : "card border-primary/30"
      }
    >
      <div className="card-body">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={`font-semibold ${isComplete ? "text-primary-foreground" : "text-foreground"} flex items-center gap-2`}
          >
            {stageLabel}
            {!isComplete && !isError && <Spinner class="h-4 w-4 animate-spin text-primary" />}
          </span>
          <div className="flex items-center gap-2">
            {progress.total > 0 && (
              <span
                className={`text-sm ${isComplete ? "text-primary-foreground/70" : "text-muted-foreground"}`}
              >
                {progress.current}/{progress.total}
              </span>
            )}
            {(isComplete || isError) && (
              <button
                type="button"
                className={
                  isError
                    ? "btn btn-outline btn-sm"
                    : "rounded-md bg-primary-foreground px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-foreground/90 transition-colors"
                }
                onClick={onImportMore}
              >
                {isError ? "Try again" : "Import more"}
              </button>
            )}
          </div>
        </div>
        {!isComplete && !isError && (
          <div className="mt-3 space-y-2">
            <div className="progress">
              <div
                className="progress-bar transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress.message && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground truncate">
                {progress.message}
              </div>
            )}
          </div>
        )}
        {isComplete && progress.message && (
          <p className="mt-2 text-sm text-primary-foreground/70">{progress.message}</p>
        )}
        {isComplete && progress.shareText && (
          <div className="mt-3">
            <a
              href={`https://bsky.app/intent/compose?text=${progress.shareText}`}
              className="rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on Bluesky
            </a>
          </div>
        )}
        {isError && progress.message && (
          <p className="mt-2 text-sm text-destructive">{progress.message}</p>
        )}
      </div>
    </div>
  );
};

// --- Main component ---

export const ImportTableApp: FC = () => {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setRows(JSON.parse(raw));
    } catch {}
  }, []);

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
          setErrors([]);
          setProgress({
            stage: "starting",
            current: 0,
            total: 0,
            message: data.stageProgress?.message as string,
          });
          break;
        }
        case "book-load": {
          const ev = data as BookLoadEvent;
          const sp = ev.stageProgress;
          setProgress({
            stage: "matching",
            current: Number(sp?.current ?? 0),
            total: Number(sp?.total ?? 0),
            message: sp?.message as string,
            bookTitle: ev.title,
            bookAuthor: ev.author,
          });
          break;
        }
        case "book-upload": {
          const ev = data as BookUploadEvent;
          setProgress((prev) => ({
            stage: "saving",
            current: ev.processed,
            total: ev.total,
            message: ev.stageProgress?.message as string,
            uploadedCount: (prev?.uploadedCount ?? 0) + (ev.book && !ev.book.alreadyExists ? 1 : 0),
          }));
          if (ev.book) {
            setRows((prev) => {
              const next = prev.some((r) => r.success && r.hiveId === ev.book.hiveId)
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
            const newTitle = normalizeStr(ev.failedBook.title);
            const newAuthor = normalizeStr(ev.failedBook.author);
            const exists = prev.some(
              (r) =>
                !r.success &&
                normalizeStr(r.title) === newTitle &&
                normalizeStr((r as any).author) === newAuthor,
            );
            return exists ? prev : prev.concat([{ success: false, ...ev.failedBook }]);
          });
          break;
        }
        case "import-error": {
          const ev = data as ImportErrorEvent;
          setErrors((prev) => [...prev, ev.error]);
          setProgress((prev) => progressAfterImportError(prev, ev));
          break;
        }
        case "import-complete": {
          const sp = data.stageProgress;
          setProgress((prev) => ({
            stage: "complete",
            current: Number(sp?.current ?? 0),
            total: Number(sp?.total ?? 0),
            message: sp?.message as string,
            uploadedCount: prev?.uploadedCount ?? 0,
            shareText: (data as any).shareText,
          }));
          break;
        }
      }
    };
    window.addEventListener("bookhive:import-event" as any, handler);
    return () => window.removeEventListener("bookhive:import-event" as any, handler);
  }, []);

  const updateRow = (hiveId: string, next: Partial<ImportRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.success && r.hiveId === hiveId ? ({ ...r, ...next } as ImportRow) : r)),
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
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
    [rows],
  );

  const alreadyCount = (successRows as any[]).filter((r) => r.alreadyExists).length;

  const onImportMore = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      {/* Progress */}
      {progress && <ProgressCard progress={progress} onImportMore={onImportMore} />}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-sm font-medium text-destructive">
                Import errors ({errors.length})
              </div>
              <div className="max-h-32 overflow-y-auto">
                {errors.map((err, i) => (
                  <div key={i} className="text-sm text-destructive/80">
                    {err}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {(rows.length > 0 || progress?.stage === "complete") && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="card p-4 text-center">
            <div className="text-sm text-muted-foreground">Imported</div>
            <div className="text-2xl font-semibold text-foreground">{successRows.length}</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-sm text-muted-foreground">Failed</div>
            <div className="text-2xl font-semibold text-foreground">{failedRows.length}</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-sm text-muted-foreground">Already in library</div>
            <div className="text-2xl font-semibold text-foreground">{alreadyCount}</div>
          </div>
        </div>
      )}

      {/* Failed imports */}
      {failedRows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header border-b border-border flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">
              Failed imports ({failedRows.length})
            </span>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {failedRows.map((row) => (
              <FailedRow
                key={`${row.title}-${row.author}`}
                row={row}
                onResolved={(success, failedKey) => {
                  const normalize = (s: string) =>
                    s?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
                  const [fkTitle, fkAuthor] = failedKey.split("::");
                  const failedKeyNorm = `${normalize(fkTitle!)}::${normalize(fkAuthor!)}`;

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
          </div>
        </div>
      )}

      {/* Successfully imported — same desktop table layout as LibraryTable */}
      {successRows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header border-b border-border">
            <span className="font-semibold text-foreground">
              Successfully imported ({successRows.length})
            </span>
          </div>
          {/* Desktop: table view */}
          <div className="hidden md:block max-h-[480px] overflow-y-auto">
            <table className="table w-full table-fixed">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th
                    className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                    style={{ width: "50%" }}
                  >
                    Book
                  </th>
                  <th
                    className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                    style={{ width: "18%" }}
                  >
                    Status
                  </th>
                  <th
                    className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                    style={{ width: "22%", minWidth: "120px" }}
                  >
                    Rating
                  </th>
                  <th
                    className="px-4 py-2 text-left text-sm font-semibold text-foreground"
                    style={{ width: "10%" }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {successRows.map((row) => (
                  <SuccessRow
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
          {/* Mobile: compact card list */}
          <div className="md:hidden max-h-[480px] overflow-y-auto">
            {successRows.map((row) => (
              <SuccessCard
                key={(row as any).hiveId}
                row={row}
                onUpdate={(next: Partial<ImportRow>) => {
                  if (row.success) updateRow(row.hiveId, next);
                }}
                onDelete={(hiveId: string) => deleteRow(hiveId)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
