import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { FadeInImage } from "@/components/FadeInImage";
import { InfinitePaginationFooter } from "@/components/InfinitePaginationFooter";
import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

function formatCount(count: number): string {
  if (count < 10) return `${count}`;
  if (count < 100) return `${Math.floor(count / 10) * 10}+`;
  if (count >= 1000) return `${Math.floor(count / 1000)}k+`;
  return `${Math.floor(count / 100) * 100}+`;
}

export function AuthorBrowser({
  authors,
  expanded,
  onToggle,
  query,
  onQueryChange,
  directory,
}: {
  authors: { author: string; bookCount: number; avgRating?: number; thumbnail?: string }[];
  expanded: boolean;
  onToggle: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  directory: ComponentProps<typeof InfinitePaginationFooter> & {
    isLoading: boolean;
    isDebouncing: boolean;
    total: number | undefined;
  };
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
          {expanded ? "Show featured authors" : "Browse author directory"}
        </ThemedText>
      </Pressable>
      {expanded && (
        <View style={{ gap: 12, marginBottom: 16 }}>
          <ThemedText style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20 }}>
            Browse the top 500 eligible authors by total ratings in your selected language, matching
            the web directory. Search filters this directory, not the whole catalogue.
          </ThemedText>
          <ThemedTextInput
            accessibilityLabel="Search author directory"
            placeholder="Search directory authors…"
            placeholderTextColor={colors.placeholderText}
            value={query}
            onChangeText={onQueryChange}
            maxLength={200}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            style={{
              minHeight: 44,
              padding: 12,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              borderRadius: 12,
            }}
          />
          {directory.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : !directory.isDebouncing && directory.total != null ? (
            <ThemedText type="caption">
              {directory.total} authors in this directory{query.trim() ? " match your search" : ""}
            </ThemedText>
          ) : null}
          {!directory.isLoading &&
            !directory.isDebouncing &&
            !directory.error &&
            directory.total === 0 && (
              <ThemedText>
                No authors match in this directory. Try another name or language.
              </ThemedText>
            )}
        </View>
      )}
      {authors.length > 0 && (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
          ]}
        >
          {authors.map((author, index) => (
            <Pressable
              key={author.author}
              accessibilityRole="button"
              onPress={() =>
                router.push(`/explore/authors/${encodeURIComponent(author.author)}` as any)
              }
              style={({ pressed }) => [
                styles.row,
                index < authors.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.cardBorder,
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              {author.thumbnail ? (
                <FadeInImage source={{ uri: author.thumbnail }} style={styles.thumbnail} />
              ) : (
                <View style={[styles.initial, { backgroundColor: colors.activeBackground }]}>
                  <ThemedText style={{ color: colors.primary }} type="heading">
                    {author.author[0]?.toUpperCase() ?? "?"}
                  </ThemedText>
                </View>
              )}
              <View style={styles.info}>
                <ThemedText style={{ color: colors.primaryText }} type="label" numberOfLines={1}>
                  {author.author}
                </ThemedText>
                <ThemedText style={{ color: colors.secondaryText }} type="caption">
                  {formatCount(author.bookCount)} books
                  {author.avgRating ? ` · ★ ${(author.avgRating / 10).toFixed(1)}` : ""}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.tertiaryText} />
            </Pressable>
          ))}
        </View>
      )}
      {expanded && !directory.isDebouncing && (
        <InfinitePaginationFooter {...directory} loadMoreLabel="Load more authors" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  thumbnail: { width: 48, height: 64, borderRadius: 8 },
  initial: {
    width: 48,
    height: 64,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1, gap: 2 },
});
