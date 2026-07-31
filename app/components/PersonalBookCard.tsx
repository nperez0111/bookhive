import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { FadeInImage } from "@/components/FadeInImage";
import { ProgressBar } from "@/components/ProgressBar";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import type { PersonalBook } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import {
  formatAuthors,
  formatFileSize,
  personalCoverSource,
  progressFraction,
} from "@/utils/personalLibrary";

type PersonalBookCardProps = {
  book: PersonalBook;
  onPress: () => void;
};

/**
 * Grid card for a file in the personal library. The whole card opens the action
 * sheet — there is no reader to open, so "manage this file" is the only
 * meaningful primary action, and the ellipsis is there to say so.
 */
export function PersonalBookCard({ book, onPress }: PersonalBookCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const cover = personalCoverSource(book.coverUrl);
  const authors = formatAuthors(book.authors);
  const fraction = book.progress ? progressFraction(book.progress.percentage) : 0;
  const hasProgress = Boolean(book.progress) && fraction > 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${book.title}${authors ? `, ${authors}` : ""}`}
      accessibilityHint="Opens actions for this file"
    >
      <View
        style={[
          styles.coverFrame,
          { backgroundColor: colors.surfaceTertiary, borderColor: colors.cardBorder },
        ]}
      >
        {cover ? (
          <FadeInImage source={cover} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={styles.coverFallback}>
            <Ionicons name="book" size={28} color={colors.primary} />
            <ThemedText
              type="caption"
              style={[styles.coverFallbackTitle, { color: colors.primaryText }]}
              numberOfLines={3}
            >
              {book.title}
            </ThemedText>
          </View>
        )}

        <View style={styles.formatBadge}>
          <ThemedText type="caption" style={styles.formatBadgeText}>
            {book.format.toUpperCase()}
          </ThemedText>
        </View>

        {book.hiveId ? (
          <View style={[styles.linkedBadge, { backgroundColor: colors.primary }]}>
            <Ionicons name="link" size={11} color="#fff" />
          </View>
        ) : null}

        {hasProgress ? (
          <ProgressBar
            value={fraction}
            height={4}
            trackColor="rgba(0, 0, 0, 0.35)"
            style={styles.coverProgress}
          />
        ) : null}
      </View>

      <ThemedText
        type="label"
        style={[styles.title, { color: colors.primaryText }]}
        numberOfLines={2}
      >
        {book.title}
      </ThemedText>
      {authors ? (
        <ThemedText type="caption" style={{ color: colors.secondaryText }} numberOfLines={1}>
          {authors}
        </ThemedText>
      ) : null}

      <View style={styles.meta}>
        <ThemedText type="caption" style={{ color: colors.tertiaryText }} numberOfLines={1}>
          {hasProgress
            ? `${Math.round(fraction * 100)}% read`
            : formatFileSize(book.sizeBytes) || book.format.toUpperCase()}
        </ThemedText>
        <Ionicons name="ellipsis-horizontal" size={14} color={colors.tertiaryText} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.75,
  },
  coverFrame: {
    width: "100%",
    aspectRatio: 2 / 3,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 8,
  },
  cover: {
    width: "100%",
    height: "100%",
  },
  coverFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
  },
  coverFallbackTitle: {
    textAlign: "center",
  },
  formatBadge: {
    position: "absolute",
    left: 6,
    top: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  formatBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  linkedBadge: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  coverProgress: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
  },
  title: {
    marginTop: 2,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
});
