import type { UserBookView } from "../../core/userBookView";

/**
 * **The one** client-side book write. Several independent copies of this used
 * to exist and disagreed about what happens when the server says no. Returns
 * a discriminated result and never throws, so callers can't fail to notice a
 * rejected write.
 */
export type BookWriteResult =
  | { ok: true; userBook: UserBookView | null }
  | { ok: false; status: number; message: string };

/** Long enough for a PDS round-trip, short enough that a wedged request can't stall a queue. */
const REQUEST_TIMEOUT_MS = 15_000;

async function request(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<BookWriteResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { ...init, signal: abort.signal });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      userBook?: UserBookView;
    };
    if (!res.ok || body.success === false) {
      return {
        ok: false,
        status: res.status,
        message: body.message || `Could not save (${res.status})`,
      };
    }
    return { ok: true, userBook: body.userBook ?? null };
  } catch {
    return { ok: false, status: 0, message: "The change could not be sent." };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    clearTimeout(timer);
  }
}

export function writeBook(
  hiveId: string,
  fields: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<BookWriteResult> {
  return request(
    "/api/update-book",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ hiveId, ...fields }),
    },
    signal,
  );
}

export function deleteBook(hiveId: string, signal?: AbortSignal): Promise<BookWriteResult> {
  return request(
    `/books/${hiveId}`,
    { method: "DELETE", headers: { accept: "application/json" } },
    signal,
  );
}
