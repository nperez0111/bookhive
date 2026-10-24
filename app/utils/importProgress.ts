export const MAX_CSV_BYTES = 50 * 1024 * 1024;
export const importProviders = ["goodreads", "storygraph", "hardcover"] as const;
export type ImportProvider = (typeof importProviders)[number];

export type ImportProgress = {
  event: string;
  stage: string;
  message: string;
  current?: number;
  total?: number;
  failedBooks: { title: string; author: string }[];
};

function parseProgress(data: string): ImportProgress | null {
  if (!data.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error("The import returned an invalid progress message.");
  }
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.event !== "string" || typeof item.stage !== "string") return null;
  const progress =
    item.stageProgress && typeof item.stageProgress === "object"
      ? (item.stageProgress as Record<string, unknown>)
      : {};
  return {
    event: item.event,
    stage: item.stage,
    message:
      typeof progress.message === "string"
        ? progress.message
        : typeof item.error === "string"
          ? item.error
          : "Importing your books…",
    current: typeof progress.current === "number" ? progress.current : undefined,
    total: typeof progress.total === "number" ? progress.total : undefined,
    failedBooks: Array.isArray(item.failedBooks)
      ? item.failedBooks.filter((book): book is { title: string; author: string } =>
          Boolean(book && typeof book.title === "string" && typeof book.author === "string"),
        )
      : [],
  };
}

/** Works with incremental XHR text and with platforms that buffer the entire response. */
export function createImportProgressParser(onProgress: (progress: ImportProgress) => void) {
  let pending = "";
  let completion: ImportProgress | null = null;
  let lastError: string | undefined;
  function consume(frame: string) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    const progress = parseProgress(data);
    if (!progress) return;
    if (progress.event === "import-complete" && progress.stage === "complete")
      completion = progress;
    if (progress.event === "import-error") lastError = progress.message;
    onProgress(progress);
  }
  return {
    push(chunk: string) {
      pending += chunk;
      // Retain a trailing CR so CRLF split across network chunks is normalized once.
      const trailingCR = pending.endsWith("\r");
      const normalized = (trailingCR ? pending.slice(0, -1) : pending).replace(/\r\n|\r/g, "\n");
      const frames = normalized.split("\n\n");
      pending = (frames.pop() ?? "") + (trailingCR ? "\r" : "");
      for (const frame of frames) consume(frame.replace(/^\uFEFF/, ""));
    },
    finish(): ImportProgress {
      if (pending.trim()) consume(pending.replace(/\r\n|\r/g, "\n"));
      pending = "";
      if (!completion)
        throw new Error(
          lastError ??
            "The import connection ended before completion. Some books may already have been imported; check your library before trying again.",
        );
      return completion;
    },
  };
}
