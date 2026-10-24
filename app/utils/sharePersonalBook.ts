import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { authSession, getBaseUrl } from "@/context/auth";
import type { PersonalBook } from "@/hooks/useBookhiveQuery";
import { personalBookFilename, downloadedBookFilename } from "@/utils/personalBookFilename";

let sharing = false;

/** Download authenticated bytes, never a session-bearing URL, then hand off to another app. */
export async function sharePersonalBook(
  book: PersonalBook,
  session = authSession.capture(),
): Promise<void> {
  session.assertCurrent();
  if (sharing) throw new Error("Another ebook is still being prepared. Please wait.");
  const sid = session.state?.sid;
  if (!sid) throw new Error("Please sign in again to download this ebook.");
  sharing = true;
  let directory: string | undefined;
  try {
    const url = `${getBaseUrl()}/xrpc/buzz.bookhive.getPersonalBookFile?contentHash=${encodeURIComponent(book.contentHash)}`;
    const headers = { cookie: `sid=${sid}` };
    const filename = personalBookFilename(book);
    if (Platform.OS === "web") {
      // FileSystem and local-file sharing are native-only. Browser downloads use
      // the same authenticated request, not an unauthenticated navigation.
      const response = await fetch(url, { headers, credentials: "omit", signal: session.signal });
      session.assertCurrent();
      if (!response.ok)
        throw new Error(`Couldn't download this ebook (${response.status}). Please try again.`);
      const blob = await response.blob();
      session.assertCurrent();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = downloadedBookFilename(book, response.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return;
    }
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("File sharing isn't available on this device.");
    }
    session.assertCurrent();
    if (!FileSystem.cacheDirectory)
      throw new Error("No download cache is available on this device.");
    const root = `${FileSystem.cacheDirectory}ebook-exports/`;
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    // Keep the previous two exports so Android recipients can finish reading
    // after the chooser returns. Only this dedicated cache is pruned, and a
    // process-wide lock prevents one export from deleting another in progress.
    const previous = (await FileSystem.readDirectoryAsync(root)).sort().reverse();
    await Promise.all(
      previous
        .slice(2)
        .map((name) => FileSystem.deleteAsync(`${root}${name}`, { idempotent: true })),
    );
    directory = `${root}${Date.now()}-${Math.random().toString(36).slice(2)}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    session.assertCurrent();
    const task = FileSystem.createDownloadResumable(
      url,
      `${directory}${encodeURIComponent(filename)}`,
      { headers },
    );
    let pausing: Promise<unknown> | undefined;
    let rejectAbort: ((error: Error) => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const abort = () => {
      pausing = task.pauseAsync().catch(() => {});
      rejectAbort?.(new Error("Authentication session changed; download cancelled"));
    };
    session.signal.addEventListener("abort", abort, { once: true });
    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      session.assertCurrent();
      result = await Promise.race([task.downloadAsync(), cancelled]);
      session.assertCurrent();
    } finally {
      session.signal.removeEventListener("abort", abort);
      if (pausing) await pausing;
    }
    if (!result) throw new Error("Ebook download cancelled.");
    if (result.status !== 200) {
      throw new Error(
        result.status === 401
          ? "Your session expired. Please sign in again."
          : `Couldn't download this ebook (${result.status}). Please try again.`,
      );
    }
    const disposition = Object.entries(result.headers).find(
      ([key]) => key.toLowerCase() === "content-disposition",
    )?.[1];
    const servedFilename = downloadedBookFilename(book, disposition);
    let uri = result.uri;
    if (servedFilename !== filename) {
      uri = `${directory}${encodeURIComponent(servedFilename)}`;
      await FileSystem.moveAsync({ from: result.uri, to: uri });
    }
    session.assertCurrent();
    const mime =
      result.mimeType ||
      Object.entries(result.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ||
      book.mime;
    await Sharing.shareAsync(uri, {
      mimeType: mime,
      dialogTitle: "Open or save ebook",
      ...(mime === "application/epub+zip" ? { UTI: "org.idpf.epub-container" } : {}),
    });
    directory = undefined; // Retained in the bounded cache for the receiving app.
  } finally {
    if (directory) await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => {});
    sharing = false;
  }
}
