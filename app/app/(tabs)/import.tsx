import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";
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

export default function ImportScreen() {
  const [provider, setProvider] = useState<ImportProvider>("goodreads");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const upload = useCsvImport();
  const busy = picking || upload.isPending;
  const pick = async () => {
    setPicking(true);
    setPickerError(null);
    try {
      // CSV MIME types vary across providers and document stores; validate the name as well.
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const selected = result.assets[0];
      if (!/\.csv$/i.test(selected.name))
        throw new Error("Choose the original .csv export, not a ZIP or spreadsheet.");
      if ((selected.size ?? 0) > MAX_CSV_BYTES)
        throw new Error("The CSV must be 50 MB or smaller.");
      upload.reset();
      setFile(selected);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "Could not open that file.");
    } finally {
      setPicking(false);
    }
  };
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <BackNavigationHeader title="Import books" />
        <ScrollView contentContainerStyle={styles.content}>
          <AccountSection
            title="Bring your reading history"
            description="Import books, reading status, ratings and reviews from your CSV export. Stay on this screen until the import finishes."
          >
            <View style={styles.providers}>
              {importProviders.map((item) => (
                <ThemedButton
                  key={item}
                  title={providerLabels[item]}
                  variant={provider === item ? "primary" : "outline"}
                  disabled={busy}
                  onPress={() => {
                    setProvider(item);
                    setFile(null);
                    upload.reset();
                  }}
                />
              ))}
            </View>
            <ThemedText>{instructions[provider]}</ThemedText>
            <ThemedText type="caption">
              Maximum file size: 50 MB. Your export is sent using your signed-in BookHive session.
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
            <ThemedButton
              title={upload.isSuccess ? "Imported" : "Import books"}
              loading={upload.isPending}
              disabled={busy || !file || upload.isSuccess}
              onPress={() => file && upload.mutate({ file, provider })}
            />
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
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 120, gap: 20 },
  providers: { gap: 10 },
  numbers: { fontVariant: ["tabular-nums"] },
});
