import { authSession, getBaseUrl } from "@/context/auth";
import type { PersonalBook } from "./personalLibraryTypes";

function isPersonalBook(value: unknown): value is PersonalBook {
  if (!value || typeof value !== "object") return false;
  const book = value as Record<string, unknown>;
  return (
    ["contentHash", "title", "format", "mime", "createdAt", "updatedAt"].every(
      (key) => typeof book[key] === "string",
    ) &&
    typeof book.contentHash === "string" &&
    book.contentHash.length > 0 &&
    typeof book.sizeBytes === "number" &&
    Number.isFinite(book.sizeBytes) &&
    book.sizeBytes >= 0 &&
    ["authors", "language", "coverUrl", "hiveId", "filename", "description"].every(
      (key) => book[key] === undefined || typeof book[key] === "string",
    ) &&
    (book.hasLocalCover === undefined || typeof book.hasLocalCover === "boolean") &&
    (book.shelfIds === undefined ||
      (Array.isArray(book.shelfIds) &&
        book.shelfIds.every(
          (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
        ))) &&
    (book.progress === undefined ||
      (book.progress !== null &&
        typeof book.progress === "object" &&
        "percentage" in book.progress &&
        typeof book.progress.percentage === "string" &&
        "updatedAt" in book.progress &&
        typeof book.progress.updatedAt === "string" &&
        (!("device" in book.progress) || typeof book.progress.device === "string")))
  );
}

/** Server prose is shown verbatim; codes determine whether to refetch quota usage. */
export class UploadError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly usedBytes?: number;
  readonly quotaBytes?: number;

  constructor(
    message: string,
    init: { code?: string; status: number; usedBytes?: number; quotaBytes?: number },
  ) {
    super(message);
    this.name = "UploadError";
    this.code = init.code;
    this.status = init.status;
    this.usedBytes = init.usedBytes;
    this.quotaBytes = init.quotaBytes;
  }
}

/** XHR streams the file off disk and supplies determinate upload progress. */
export function uploadBookFile(
  {
    uri,
    name,
    mime,
    onProgress,
  }: {
    uri: string;
    name: string;
    mime?: string;
    onProgress?: (fraction: number) => void;
  },
  session: ReturnType<typeof authSession.capture>,
): Promise<{ book: PersonalBook }> {
  session.assertCurrent();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", { uri, name, type: mime || "application/octet-stream" } as unknown as Blob);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${getBaseUrl()}/library/upload`);
    xhr.withCredentials = false;
    xhr.setRequestHeader("accept", "application/json");
    xhr.setRequestHeader("cookie", `sid=${session.state?.sid ?? ""}`);
    const abort = () => {
      xhr.abort();
      reject(new Error("Authentication session changed; upload cancelled"));
    };
    session.signal.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => session.signal.removeEventListener("abort", abort);
    xhr.upload.onprogress = (event) => {
      if (session.signal.aborted) return;
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        session.assertCurrent();
      } catch (error) {
        reject(error);
        return;
      }
      let payload: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(xhr.responseText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        // Non-JSON responses use the status-based message below.
      }
      if (xhr.status >= 200 && xhr.status < 300 && isPersonalBook(payload?.book)) {
        onProgress?.(1);
        resolve({ book: payload.book });
        return;
      }
      reject(
        new UploadError(
          (typeof payload?.error === "string" && payload.error) ||
            (xhr.status === 401
              ? "Your session expired. Sign in again to upload."
              : xhr.status >= 200 && xhr.status < 300
                ? "The server returned an invalid upload response. Refresh your library before trying again."
                : `Upload failed (${xhr.status})`),
          {
            code: typeof payload?.code === "string" ? payload.code : undefined,
            status: xhr.status,
            usedBytes: typeof payload?.usedBytes === "number" ? payload.usedBytes : undefined,
            quotaBytes: typeof payload?.quotaBytes === "number" ? payload.quotaBytes : undefined,
          },
        ),
      );
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.timeout = 5 * 60_000;
    xhr.ontimeout = () =>
      reject(new Error("Upload timed out. Check your connection and try again."));
    try {
      session.assertCurrent();
      xhr.send(form);
    } catch (error) {
      session.signal.removeEventListener("abort", abort);
      reject(error);
    }
  });
}
