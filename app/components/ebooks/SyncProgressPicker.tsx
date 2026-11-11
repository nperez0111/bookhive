import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import type { SyncDoc } from "@/api/personalLibraryTypes";
import { ThemedText } from "@/components/ThemedText";
import { ThemedButton } from "@/components/ThemedButton";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { documentTitle } from "@/utils/syncDocuments";
import { progressFraction } from "@/utils/personalLibrary";

/** No file→document identity is exposed by the API. Selection is explicit even
 * for one document: neither a title nor hasFile proves which upload it belongs to. */
export function SyncProgressPicker({
  visible,
  fileTitle,
  bookTitle,
  documents,
  loading,
  loadError,
  error,
  fileLinked,
  busy,
  onRetry,
  onClose,
  onSelect,
  onFileOnly,
}: {
  visible: boolean;
  fileTitle: string;
  bookTitle: string;
  documents: SyncDoc[];
  loading: boolean;
  loadError: Error | null;
  error?: string;
  fileLinked: boolean;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
  onSelect: (document: SyncDoc) => void;
  onFileOnly: () => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
        <Pressable
          style={{ flex: 1 }}
          onPress={onClose}
          accessibilityLabel="Dismiss progress selection"
        />
        <View
          style={{
            maxHeight: "85%",
            backgroundColor: colors.cardBackground,
            padding: 24,
            paddingBottom: 40,
            gap: 16,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }}
        >
          <ThemedText type="heading">Choose saved e-reader progress</ThemedText>
          <ThemedText type="label">
            {fileTitle} → {bookTitle}
          </ThemedText>
          <ThemedText>
            {fileLinked ? "The file is linked. " : "Before linking this file, "}
            choose its actual synced document below. This is all your sync history, not a list of
            confirmed matches. Check the filename, device and document ID; choosing another book
            will move that book&apos;s progress.
          </ThemedText>
          {error ? (
            <ThemedText accessibilityRole="alert" style={{ color: colors.errorText }}>
              {error}
            </ThemedText>
          ) : null}
          {busy ? (
            <ActivityIndicator
              accessibilityLabel="Linking selected progress"
              color={colors.primary}
            />
          ) : null}
          {loading ? (
            <ActivityIndicator accessibilityLabel="Loading sync documents" color={colors.primary} />
          ) : loadError ? (
            <View style={{ gap: 8 }}>
              <ThemedText accessibilityRole="alert">
                Couldn&apos;t load saved progress. Retry to choose a document.
              </ThemedText>
              <ThemedButton title="Retry sync history" onPress={onRetry} disabled={busy} />
            </View>
          ) : documents.length === 0 ? (
            <ThemedText>
              No synced documents are available. You can link the file without moving progress, or
              cancel and refresh your library.
            </ThemedText>
          ) : (
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8 }}>
              {documents.map((doc) => (
                <Pressable
                  key={doc.document}
                  accessibilityRole="button"
                  accessibilityLabel={`Use progress from ${documentTitle(doc)}, document ${doc.document}`}
                  disabled={busy}
                  onPress={() => onSelect(doc)}
                  style={{
                    minHeight: 44,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.cardBorder,
                    gap: 4,
                  }}
                >
                  <ThemedText type="label">{documentTitle(doc)}</ThemedText>
                  <ThemedText type="caption">
                    {[
                      doc.filename,
                      doc.device,
                      `${Math.round(progressFraction(doc.percentage) * 100)}%`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </ThemedText>
                  <ThemedText type="caption">Document ID: {doc.document}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {!fileLinked ? (
            <ThemedButton
              title="Link file only — don't move progress"
              variant="outline"
              disabled={busy}
              onPress={onFileOnly}
            />
          ) : null}
          <ThemedButton
            title={fileLinked && !busy ? "Done" : "Cancel"}
            variant="ghost"
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}
