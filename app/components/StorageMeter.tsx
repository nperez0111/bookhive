import React from "react";
import { StyleSheet, View } from "react-native";

import { ProgressBar } from "@/components/ProgressBar";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import type { PersonalStorage } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { formatBytes } from "@/utils/personalLibrary";

/** Fill ratio past which the bar turns amber to warn before the upload fails. */
const WARN_AT = 0.9;

type StorageMeterProps = {
  storage: PersonalStorage | null;
};

/**
 * Library storage used against the quota — the app's counterpart to the web
 * `StorageMeter` in `src/client/components/LibraryManager.tsx`.
 *
 * Renders nothing without a quota. `quotaBytes <= 0` is how a deployment turns
 * the quota off, and a meter with no ceiling is noise; an older server that
 * doesn't send `storage` at all lands in the same branch, which is what keeps
 * this screen working against one.
 */
export function StorageMeter({ storage }: StorageMeterProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  if (!storage || storage.quotaBytes <= 0) return null;

  const ratio = Math.min(1, storage.usedBytes / storage.quotaBytes);
  const isFull = storage.usedBytes >= storage.quotaBytes;
  const barColor = ratio >= WARN_AT ? colors.warning : colors.primary;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="caption" style={{ color: colors.secondaryText }}>
          {formatBytes(storage.usedBytes)} of {formatBytes(storage.quotaBytes)} used
        </ThemedText>
        {isFull ? (
          <ThemedText type="caption" style={{ color: colors.warning }}>
            Library full
          </ThemedText>
        ) : null}
      </View>
      <ProgressBar
        value={ratio}
        height={4}
        color={barColor}
        trackColor={colors.inactiveBackground}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
