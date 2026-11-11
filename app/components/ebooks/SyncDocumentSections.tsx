import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import type { SyncDoc } from "@/api/personalLibraryTypes";
import { formatAuthors, progressFraction } from "@/utils/personalLibrary";
import { documentTitle } from "@/utils/syncDocuments";

export function SyncDocumentTriage({
  documents,
  onMatch,
  onActions,
}: {
  documents: SyncDoc[];
  onMatch: (doc: SyncDoc) => void;
  onActions: (doc: SyncDoc) => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  if (!documents.length) return null;
  return (
    <View
      style={[
        styles.triage,
        { borderColor: colors.primary, backgroundColor: colors.activeBackground },
      ]}
    >
      <View style={styles.triageHeader}>
        <Ionicons name="sync-circle" size={20} color={colors.primary} />
        <View style={styles.triageHeaderText}>
          <ThemedText type="label" style={{ color: colors.primaryText }}>
            {documents.length} from your e-reader
          </ThemedText>
          <ThemedText type="caption" style={{ color: colors.secondaryText }}>
            Link them so progress lands on the right book
          </ThemedText>
        </View>
      </View>
      {documents.map((doc, index) => (
        <AnimatedListItem key={doc.document} index={index}>
          <View style={[styles.triageRow, { borderTopColor: colors.cardBorder }]}>
            <View style={styles.triageRowText}>
              <ThemedText type="label" style={{ color: colors.primaryText }} numberOfLines={1}>
                {documentTitle(doc)}
              </ThemedText>
              <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                {[
                  `${Math.round(progressFraction(doc.percentage) * 100)}%`,
                  formatAuthors(doc.authors) || doc.device,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => onMatch(doc)}
              style={[styles.matchButton, { backgroundColor: colors.primary }]}
            >
              <ThemedText type="caption" style={styles.matchButtonText}>
                Link
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => onActions(doc)}
              hitSlop={8}
              accessibilityLabel={`More actions for ${documentTitle(doc)}`}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.secondaryText} />
            </Pressable>
          </View>
        </AnimatedListItem>
      ))}
    </View>
  );
}

export function TrackedSyncDocuments({
  documents,
  onActions,
}: {
  documents: SyncDoc[];
  onActions: (doc: SyncDoc) => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  if (!documents.length) return null;
  return (
    <View style={styles.trackedSection}>
      <ThemedText type="overline" style={[styles.trackedTitle, { color: colors.secondaryText }]}>
        Also tracking
      </ThemedText>
      <ThemedText type="caption" style={{ color: colors.tertiaryText, marginBottom: 12 }}>
        Synced from your e-reader with no file uploaded here.
      </ThemedText>
      {documents.map((doc) => (
        <Pressable
          key={doc.document}
          onPress={() => onActions(doc)}
          style={({ pressed }) => [
            styles.trackedRow,
            {
              borderColor: colors.cardBorder,
              backgroundColor: pressed ? colors.activeBackground : colors.cardBackground,
            },
          ]}
        >
          <View
            style={[
              styles.trackedIcon,
              {
                backgroundColor: doc.dismissed
                  ? colors.inactiveBackground
                  : colors.activeBackground,
              },
            ]}
          >
            <Ionicons
              name={doc.dismissed ? "remove-circle-outline" : "link"}
              size={16}
              color={doc.dismissed ? colors.tertiaryText : colors.primary}
            />
          </View>
          <View style={styles.trackedText}>
            <ThemedText type="label" style={{ color: colors.primaryText }} numberOfLines={1}>
              {documentTitle(doc)}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.secondaryText }} numberOfLines={1}>
              {doc.dismissed
                ? "Not on BookHive"
                : `${Math.round(progressFraction(doc.percentage) * 100)}% · ${doc.bookTitle ?? "Linked"}`}
            </ThemedText>
          </View>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.tertiaryText} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  triage: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 20 },
  triageHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 8 },
  triageHeaderText: { flex: 1, gap: 1 },
  triageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  triageRowText: { flex: 1, gap: 1 },
  matchButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  matchButtonText: { color: "#fff", fontWeight: "600" },
  trackedSection: { marginTop: 8, marginBottom: 8 },
  trackedTitle: { marginBottom: 2 },
  trackedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  trackedIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  trackedText: { flex: 1, gap: 1 },
});
