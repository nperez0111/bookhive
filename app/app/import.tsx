import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { authSession } from "@/context/auth";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedButton } from "@/components/ThemedButton";
import { ProgressBar } from "@/components/ProgressBar";
import { AccountSection } from "@/components/account/AccountSection";
import { useCsvImport } from "@/hooks/useCsvImport";
import { importProviders, MAX_CSV_BYTES, type ImportProvider } from "@/utils/importProgress";

const providerLabels = { goodreads: "Goodreads", storygraph: "StoryGraph", hardcover: "Hardcover" };
const instructions = {
  goodreads:
    "In Goodreads, go to My Books → Import and export → Export library. Download the CSV when it is ready.",
  storygraph:
    "In StoryGraph, open Manage Account → Export StoryGraph Library, then download your CSV export.",
  hardcover: "In Hardcover, open Settings → Import & Export and export your library as CSV.",
};

// Called only for the result of our copyToCacheDirectory picker. Native Expo
// generates a fresh file in this directory; arbitrary cache files are not ours.
function pickerCopyRelease(asset: DocumentPicker.DocumentPickerAsset) {
  let released = false;
  return () => {
    if (released || Platform.OS === "web") return;
    released = true;
    try {
      const uri = new URL(asset.uri);
      const directory = new URL(`${Paths.cache.uri.replace(/\/$/, "")}/DocumentPicker/`);
      const filename = uri.pathname.slice(directory.pathname.length);
      if (
        uri.protocol !== "file:" ||
        uri.host !== directory.host ||
        !uri.pathname.startsWith(directory.pathname) ||
        !filename ||
        filename.includes("/")
      )
        return;
      const copy = new File(asset.uri);
      if (copy.exists) copy.delete();
    } catch (error) {
      console.warn("Unable to remove picked CSV cache copy:", error);
    }
  };
}

type Selection = { asset: DocumentPicker.DocumentPickerAsset; release: () => void };

export default function ImportScreen() {
  const top = useScreenTopInset();
  const [provider, setProvider] = useState<ImportProvider>("goodreads");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const mounted = useRef(true);
  const working = useRef(false);
  const selection = useRef<Selection | null>(null);
  const inFlight = useRef<Selection | null>(null);
  const upload = useCsvImport();
  const session = authSession.capture();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (selection.current !== inFlight.current) selection.current?.release();
    };
  }, []);
  const busy = picking || upload.isPending;
  const pick = async () => {
    if (working.current || !mounted.current || session.signal.aborted) return;
    working.current = true;
    setPicking(true);
    setPickerError(null);
    let picked: Selection | null = null;
    const isCurrent = () => mounted.current && !session.signal.aborted;
    try {
      // CSV MIME types vary across providers and document stores; validate the name as well.
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const selected = result.assets[0];
      if (!selected) throw new Error("No file was selected.");
      picked = { asset: selected, release: pickerCopyRelease(selected) };
      if (!isCurrent()) return;
      if (!/\.csv$/i.test(selected.name))
        throw new Error("Choose the original .csv export, not a ZIP or spreadsheet.");
      if ((selected.size ?? 0) > MAX_CSV_BYTES)
        throw new Error("The CSV must be 50 MB or smaller.");
      upload.reset();
      selection.current?.release();
      selection.current = picked;
      picked = null;
      setFile(selected);
    } catch (error) {
      if (isCurrent())
        setPickerError(error instanceof Error ? error.message : "Could not open that file.");
    } finally {
      picked?.release();
      working.current = false;
      if (isCurrent()) setPicking(false);
    }
  };
  const importBooks = async () => {
    const selected = selection.current;
    if (!selected || working.current || !mounted.current || session.signal.aborted) return;
    working.current = true;
    inFlight.current = selected;
    try {
      await upload.mutateAsync({ file: selected.asset, provider });
    } catch {
      // The mutation owns visible errors, including uncertain/partial imports.
    } finally {
      // Streaming owns the file until settlement, including an unmount/abort.
      selected.release();
      inFlight.current = null;
      if (selection.current === selected) {
        selection.current = null;
        if (mounted.current && !session.signal.aborted) setFile(null);
      }
      working.current = false;
    }
  };
  return (
    <ThemedView style={styles.root}>
      <View style={[styles.root, { paddingTop: top }]}>
        <BackNavigationHeader title="Import books" />
        <ScrollView contentContainerStyle={styles.content}>
          <AccountSection
            title="Bring your reading history"
            description="Bring books, ratings and reviews from another reading app."
          >
            <View style={styles.providers}>
              {importProviders.map((item) => (
                <ThemedButton
                  key={item}
                  title={providerLabels[item]}
                  variant={provider === item ? "primary" : "outline"}
                  disabled={busy}
                  onPress={() => {
                    if (working.current) return;
                    selection.current?.release();
                    selection.current = null;
                    setProvider(item);
                    setFile(null);
                    upload.reset();
                  }}
                />
              ))}
            </View>
            <ThemedText>{instructions[provider]}</ThemedText>
            <ThemedText type="caption">
              CSV files up to 50 MB. Stay here until the import finishes.
            </ThemedText>
            <ThemedButton
              title={file ? "Choose a different CSV" : "Choose CSV file"}
              variant="secondary"
              disabled={busy}
              loading={picking}
              onPress={pick}
            />
            {file && <ThemedText>{file.name}</ThemedText>}
            {pickerError && <ThemedText accessibilityRole="alert">{pickerError}</ThemedText>}
            {file && (
              <ThemedButton
                title={upload.isSuccess ? "Imported" : "Import books"}
                loading={upload.isPending}
                disabled={busy || !file || upload.isSuccess}
                onPress={() => void importBooks()}
              />
            )}
          </AccountSection>
          {(upload.isPending || upload.isSuccess || upload.isError) && (
            <AccountSection
              title={
                upload.isSuccess
                  ? "Import complete"
                  : upload.isError
                    ? "Import interrupted"
                    : "Import in progress"
              }
              description={
                upload.progress?.message ??
                (upload.uploadProgress < 1
                  ? "Uploading your CSV…"
                  : "Processing your books. Progress may appear when the import finishes on this device.")
              }
            >
              {upload.isPending && (
                <>
                  <ProgressBar value={upload.uploadProgress} />
                  <ThemedText accessibilityLiveRegion="polite" style={styles.numbers}>
                    {Math.round(upload.uploadProgress * 100)}% uploaded
                  </ThemedText>
                  {upload.progress?.total !== undefined && (
                    <ThemedText style={styles.numbers}>
                      {upload.progress.current ?? 0} / {upload.progress.total} books
                    </ThemedText>
                  )}
                </>
              )}
              {upload.isError && (
                <ThemedText accessibilityRole="alert">
                  {upload.error instanceof Error
                    ? upload.error.message
                    : "Import failed. Check your library before trying again."}
                </ThemedText>
              )}
              {upload.data && upload.data.failedBooks.length > 0 && (
                <>
                  <ThemedText>
                    {upload.data.failedBooks.length} books could not be imported. You can add them
                    individually:
                  </ThemedText>
                  {upload.data.failedBooks.slice(0, 30).map((book, i) => (
                    <ThemedText key={i}>
                      • {book.title} — {book.author}
                    </ThemedText>
                  ))}
                  {upload.data.failedBooks.length > 30 && (
                    <ThemedText>And {upload.data.failedBooks.length - 30} more.</ThemedText>
                  )}
                </>
              )}
            </AccountSection>
          )}
        </ScrollView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 120, gap: 20 },
  providers: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  numbers: { fontVariant: ["tabular-nums"] },
});
