import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { formatDistanceToNow } from "date-fns";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import type { BookProgress } from "../../../src/types";
import { metricRows } from "./progressDraft";
import type { ReadingProgressDraft } from "./useReadingProgressDraft";
import { calculatePercentFromProgressValues } from "@/utils/calculatePercentFromProgressValues";

export function ReadingProgressCard({
  progress,
  draft,
  isBusy,
  saving,
  error,
  success,
  onSave,
  editing,
  onEditingChange,
}: {
  progress: BookProgress | undefined;
  draft: ReadingProgressDraft;
  isBusy: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  onSave: () => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  // The summary describes saved progress, never the editor's unsaved draft.
  const percentDisplay =
    progress?.percent ?? (progress ? calculatePercentFromProgressValues(progress) : null);
  const ticks: string[] = [];
  if (progress?.currentPage) {
    ticks.push(
      `${progress.currentPage}${progress.totalPages ? `/${progress.totalPages}` : ""} pages`,
    );
  }
  if (progress?.currentChapter) {
    ticks.push(
      `${progress.currentChapter}${progress.totalChapters ? `/${progress.totalChapters}` : ""} chapters`,
    );
  }
  const updatedAt = progress?.updatedAt
    ? formatDistanceToNow(new Date(progress.updatedAt), { addSuffix: true })
    : null;
  const summary =
    ticks.length || updatedAt
      ? `${ticks.join(" • ")}${ticks.length && updatedAt ? " • " : ""}${updatedAt ? `Updated ${updatedAt}` : ""}`
      : null;

  return (
    <View style={[styles.card, { borderColor: colors.cardBorder }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Update reading progress"
        accessibilityState={{ expanded: editing }}
        onPress={() => onEditingChange(!editing)}
        style={styles.disclosure}
      >
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontSize: 18, lineHeight: 24, fontWeight: "600" }}>
            Reading progress
          </ThemedText>
          <ThemedText style={[styles.summary, { color: colors.secondaryText }]}>
            {percentDisplay != null
              ? `${percentDisplay}% complete`
              : summary || "No progress recorded"}
          </ThemedText>
          {percentDisplay != null && summary && (
            <ThemedText style={[styles.summary, { color: colors.secondaryText }]}>
              {summary}
            </ThemedText>
          )}
        </View>
        <Ionicons
          name={editing ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.secondaryText}
        />
      </Pressable>
      {editing && (
        <>
          {metricRows.map((row) => (
            <View key={row[0].field} style={styles.row}>
              {row.map(({ field, label, placeholder }) => (
                <View key={field} style={styles.field}>
                  <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                    {label}
                  </ThemedText>
                  <TextInput
                    accessibilityLabel={label}
                    value={draft.fields[field]}
                    editable={!isBusy}
                    onChangeText={(text) => draft.changeMetric(field, text)}
                    keyboardType="numeric"
                    placeholder={placeholder}
                    placeholderTextColor={colors.placeholderText}
                    style={[styles.input, { color: colors.text, borderColor: colors.tertiaryText }]}
                  />
                </View>
              ))}
            </View>
          ))}
          <View style={styles.field}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>Percent</ThemedText>
            <TextInput
              accessibilityLabel="Percent complete"
              value={draft.percentInput}
              editable={!isBusy}
              onChangeText={draft.changePercent}
              keyboardType="numeric"
              placeholder="Auto-calculated"
              placeholderTextColor={colors.placeholderText}
              style={[styles.input, { color: colors.text, borderColor: colors.tertiaryText }]}
            />
          </View>
          <ThemedText style={[styles.hint, { color: colors.secondaryText }]}>
            Percent auto-updates when pages or chapters change.
          </ThemedText>
          {error && (
            <ThemedText
              accessibilityRole="alert"
              style={[styles.error, { color: colors.errorText }]}
            >
              {error}
            </ThemedText>
          )}
          {success && (
            <ThemedText
              accessibilityLiveRegion="polite"
              style={[styles.success, { color: colors.primaryText }]}
            >
              {success}
            </ThemedText>
          )}
          <View style={styles.buttonContainer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save progress"
              accessibilityState={{ disabled: saving || isBusy, busy: saving }}
              style={[
                styles.button,
                { backgroundColor: colors.primary },
                (saving || isBusy) && styles.buttonDisabled,
              ]}
              onPress={onSave}
              disabled={saving || isBusy}
            >
              {saving ? (
                <ActivityIndicator color={Colors.light.primaryText} />
              ) : (
                <ThemedText style={[styles.buttonText, { color: Colors.light.primaryText }]}>
                  Save progress
                </ThemedText>
              )}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  summary: { fontSize: 14, lineHeight: 20 },
  disclosure: {
    minHeight: 44,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  row: { flexDirection: "row", gap: 12, marginTop: 12 },
  field: { flex: 1, marginTop: 10 },
  label: { fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    fontSize: 16,
    backgroundColor: "transparent",
  },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 10 },
  error: { fontSize: 12, marginTop: 6 },
  success: { fontSize: 12, marginTop: 6 },
  buttonContainer: { marginTop: 12 },
  button: {
    minHeight: 44,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: "600" },
});
