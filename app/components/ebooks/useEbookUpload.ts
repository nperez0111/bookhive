import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import { authSession } from "@/context/auth";

import type { PersonalBook, PersonalStorage } from "@/api/personalLibraryTypes";
import type { useUploadPersonalBook } from "@/hooks/queries/personalLibrary";
import { formatBytes } from "@/utils/personalLibrary";

/** Mirrors the formats the upload route accepts (`ACCEPTED_EXTENSIONS`). */
const ACCEPTED_EXTENSIONS = ["epub", "mobi", "azw", "azw3", "fb2", "cbz"];

/** Picker/quota UI only. The caller creates the session-bound mutation during render. */
export function useEbookUpload({
  storage,
  upload,
  onUnmatched,
}: {
  storage: PersonalStorage | null;
  upload: Pick<ReturnType<typeof useUploadPersonalBook>, "mutateAsync">;
  onUnmatched: (book: PersonalBook) => void;
}) {
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isBusy, setBusy] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const session = authSession.capture();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleUpload = useCallback(async () => {
    if (busy.current || !mounted.current || session.signal.aborted) return;
    if (storage && storage.quotaBytes > 0 && storage.usedBytes >= storage.quotaBytes) {
      Alert.alert(
        "Library full",
        `You've used ${formatBytes(storage.usedBytes)} of your ${formatBytes(storage.quotaBytes)}. Delete a book to free up space.`,
      );
      return;
    }
    busy.current = true;
    setBusy(true);
    const isCurrent = () => mounted.current && !session.signal.aborted;
    let copiedUri: string | undefined;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      copiedUri = asset.uri;
      if (!isCurrent()) return;
      const extension = asset.name.toLowerCase().split(".").pop() ?? "";
      if (
        !ACCEPTED_EXTENSIONS.includes(extension) &&
        !asset.name.toLowerCase().endsWith(".fb2.zip")
      ) {
        Alert.alert(
          "Unsupported file",
          `BookHive accepts ${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(", ")} files.`,
        );
        return;
      }
      // A hint only. The server evaluates quota again inside its INSERT.
      if (storage && storage.quotaBytes > 0 && asset.size != null) {
        const free = Math.max(0, storage.quotaBytes - storage.usedBytes);
        if (asset.size > free) {
          Alert.alert(
            "Not enough space",
            `“${asset.name}” is ${formatBytes(asset.size)}, but only ${formatBytes(free)} of your ${formatBytes(storage.quotaBytes)} is free. Delete a book to make room.`,
          );
          return;
        }
      }
      setUploadName(asset.name);
      setUploadProgress(0);
      const { book } = await upload.mutateAsync({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType,
        onProgress: (progress) => {
          if (isCurrent()) setUploadProgress(progress);
        },
      });
      if (isCurrent()) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (!book.hiveId) onUnmatched(book);
      }
    } catch (error) {
      if (isCurrent())
        Alert.alert(
          "Upload failed",
          error instanceof Error ? error.message : "Unable to select or upload this file.",
        );
    } finally {
      // Retain the copy until the streaming request settles, even after navigation.
      // Never delete the user's original file or a non-cache picker URI.
      if (copiedUri) {
        try {
          const file = new File(copiedUri);
          const cachePrefix = `${Paths.cache.uri.replace(/\/$/, "")}/`;
          if (file.uri.startsWith(cachePrefix) && file.exists) file.delete();
        } catch (error) {
          console.warn("Unable to remove picked ebook cache copy:", error);
        }
      }
      busy.current = false;
      if (mounted.current) {
        setBusy(false);
        setUploadProgress(null);
        setUploadName(null);
      }
    }
  }, [upload, storage, onUnmatched, session]);

  return { handleUpload, uploadName, uploadProgress, isBusy };
}
