import type { ComponentProps } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { genreEmojiImage } from "./genreEmojiImages";
import { InfinitePaginationFooter } from "@/components/InfinitePaginationFooter";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

export function GenreBrowser({
  genres,
  expanded,
  onToggle,
  directory,
}: {
  genres: { genre: string; count: number }[];
  expanded: boolean;
  onToggle: () => void;
  directory: ComponentProps<typeof InfinitePaginationFooter> & { isLoading: boolean };
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <ThemedText style={{ color: colors.text, textDecorationLine: "underline" }}>
          {expanded ? "Show featured genres" : "Browse all genres"}
        </ThemedText>
      </Pressable>
      {expanded && (
        <ThemedText
          style={{ marginBottom: 12, color: colors.secondaryText, fontSize: 14, lineHeight: 20 }}
        >
          Directory counts include all languages.
        </ThemedText>
      )}
      {expanded && directory.isLoading && <ActivityIndicator color={colors.primary} />}
      <View style={styles.grid}>
        {genres.map((item) => (
          <Pressable
            key={item.genre}
            accessibilityRole="button"
            onPress={() => router.push(`/explore/genres/${encodeURIComponent(item.genre)}` as any)}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Image accessible={false} source={genreEmojiImage(item.genre)} style={styles.emoji} />
            <ThemedText
              style={[styles.name, { color: colors.primaryText }]}
              type="label"
              numberOfLines={2}
            >
              {item.genre}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.secondaryText }}>
              {item.count.toLocaleString()} books
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {expanded && !directory.isLoading && !directory.error && genres.length === 0 && (
        <ThemedText>No genres are available in this catalogue yet.</ThemedText>
      )}
      {expanded && <InfinitePaginationFooter {...directory} loadMoreLabel="Load more genres" />}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    width: "47%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    minHeight: 56,
    justifyContent: "center",
  },
  name: { textAlign: "center" },
  emoji: {
    width: 28,
    height: 28,
    alignSelf: "center",
    marginBottom: 4,
  },
});
