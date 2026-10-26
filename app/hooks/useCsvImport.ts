import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DocumentPickerAsset } from "expo-document-picker";
import { authSession, getBaseUrl } from "@/context/auth";
import {
  createImportProgressParser,
  MAX_CSV_BYTES,
  type ImportProgress,
  type ImportProvider,
} from "@/utils/importProgress";

type ImportInput = { file: DocumentPickerAsset; provider: ImportProvider };
type SessionScope = ReturnType<typeof authSession.capture>;

export function useCsvImport() {
  const queryClient = useQueryClient();
  // Retained callbacks belong to the render's account, not whoever is signed in when invoked.
  const renderScope = authSession.capture();
  const active = useRef<XMLHttpRequest | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const mutation = useMutation({
    retry: false,
    mutationFn: ({ file, provider, scope }: ImportInput & { scope: SessionScope }) => {
      scope.assertCurrent();
      setUploadProgress(0);
      setProgress(null);
      if ((file.size ?? 0) > MAX_CSV_BYTES) throw new Error("Choose a CSV smaller than 50 MB.");
      const sid = scope.state?.sid;
      if (!sid) throw new Error("Sign in again to import your books.");
      return new Promise<ImportProgress>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        active.current = xhr;
        const abort = () => xhr.abort();
        const cleanup = () => {
          scope.signal.removeEventListener("abort", abort);
          if (active.current === xhr) active.current = null;
        };
        const parser = createImportProgressParser((event) => {
          if (!scope.signal.aborted) setProgress(event);
        });
        let consumed = 0;
        const readProgress = () => {
          const text = xhr.responseText;
          parser.push(text.slice(consumed));
          consumed = text.length;
        };
        xhr.open("POST", `${getBaseUrl()}/import/${provider}`);
        xhr.timeout = 6 * 60 * 1000;
        xhr.setRequestHeader("cookie", `sid=${sid}`);
        xhr.setRequestHeader("accept", "text/event-stream");
        xhr.upload.onprogress = (event) => {
          if (scope.signal.aborted) return;
          if (event.lengthComputable && event.total > 0)
            setUploadProgress(event.loaded / event.total);
        };
        xhr.onprogress = () => {
          // Some RN platforms expose responseText only on load; finish parses that same buffer.
          if (scope.signal.aborted || xhr.status !== 200) return;
          try {
            readProgress();
          } catch {
            /* Some platforms expose responseText only on load. */
          }
        };
        xhr.onload = () => {
          cleanup();
          try {
            scope.assertCurrent();
          } catch (error) {
            reject(error);
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            let message =
              xhr.status === 401
                ? "Your session expired. Sign in again."
                : xhr.status === 413
                  ? "Choose a CSV smaller than 50 MB."
                  : "The import could not start. Please try again.";
            try {
              const body = JSON.parse(xhr.responseText);
              if (typeof body.error === "string") message = body.error;
            } catch {
              /* Not a JSON error response. */
            }
            reject(new Error(message));
            return;
          }
          try {
            readProgress();
            resolve(parser.finish());
          } catch (error) {
            reject(error);
          }
        };
        xhr.onerror = () => {
          cleanup();
          reject(
            new Error(
              "Connection lost. Some books may already be imported; check your library before retrying.",
            ),
          );
        };
        xhr.ontimeout = () => {
          cleanup();
          reject(new Error("Import timed out. Check your library before retrying."));
        };
        xhr.onabort = () => {
          cleanup();
          reject(new Error("Import stopped. Books already saved remain in your library."));
        };
        const form = new FormData();
        form.append(
          "export",
          file.file ??
            ({
              uri: file.uri,
              name: file.name,
              type: file.mimeType || "text/csv",
            } as unknown as Blob),
        );
        scope.assertCurrent();
        scope.signal.addEventListener("abort", abort, { once: true });
        xhr.send(form);
      });
    },
    // A disconnected import may have saved part of the file, so invalidate on failure too.
    onSettled: (_data, _error, { scope }) => {
      if (!scope.signal.aborted) return queryClient.invalidateQueries();
    },
  });
  return {
    ...mutation,
    mutate: (input: ImportInput) => mutation.mutate({ ...input, scope: renderScope }),
    mutateAsync: (input: ImportInput) => mutation.mutateAsync({ ...input, scope: renderScope }),
    uploadProgress,
    progress,
  };
}
