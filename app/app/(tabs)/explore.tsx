import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FadeInImage } from "@/components/FadeInImage";
import { GradientView } from "@/components/GradientView";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { SectionHeader } from "@/components/SectionHeader";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useExplore } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

function formatCount(count: number): string {
  if (count < 10) return `${count}`;
  if (count < 100) return `${Math.floor(count / 10) * 10}+`;
  if (count >= 1000) return `${Math.floor(count / 1000)}k+`;
  return `${Math.floor(count / 100) * 100}+`;
}

export default function ExploreScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const { top } = useSafeAreaInsets();
  const explore = useExplore();

  if (explore.isLoading) {
    return (
      <ThemedView style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </ThemedView>
    );
  }

  if (explore.error) {
    return (
      <QueryErrorHandler
        error={explore.error}
        onRetry={() => explore.refetch()}
        showRetryButton
        showGoBackButton={false}
      />
    );
  }

  const genres = explore.data?.genres ?? [];
  const topAuthors = explore.data?.topAuthors ?? [];

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <GradientView variant="warm" style={[styles.header, { paddingTop: top + 12 }]}>
        <ThemedText
          style={[
            styles.headerTitle,
            { color: colorScheme === "dark" ? "#ffffff" : "#1a1a1a" },
          ]}
          type="title"
        >
          Explore
        </ThemedText>
        <ThemedText
          style={[
            styles.headerSubtitle,
            { color: colorScheme === "dark" ? "#f7fafc" : "#4a5568" },
          ]}
          type="body"
        >
          Discover by genre or author
        </ThemedText>
      </GradientView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 20 + bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Genres */}
        <View style={styles.section}>
          <SectionHeader
            icon={"bookmark" as any}
            title="Top Genres"
            style={{ marginBottom: 16 }}
          />
          <View style={styles.genreGrid}>
            {genres.map((item) => (
              <Pressable
                key={item.genre}
                onPress={() =>
                  router.push(
                    `/explore/genres/${encodeURIComponent(item.genre)}` as any,
                  )
                }
                style={({ pressed }) => [
                  styles.genreCard,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: colors.cardBorder,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <ThemedText
                  style={[styles.genreCount, { color: colors.primary }]}
                  type="heading"
                >
                  {formatCount(item.count)}
                </ThemedText>
                <ThemedText
                  style={[styles.genreName, { color: colors.primaryText }]}
                  type="label"
                  numberOfLines={2}
                >
                  {item.genre}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Top Authors */}
        <View style={styles.section}>
          <SectionHeader
            icon={"person" as any}
            title="Top Authors"
            style={{ marginBottom: 16 }}
          />
          <View
            style={[
              styles.authorsCard,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
              },
            ]}
          >
            {topAuthors.map((author, index) => (
              <Pressable
                key={author.author}
                onPress={() =>
                  router.push(
                    `/explore/authors/${encodeURIComponent(author.author)}` as any,
                  )
                }
                style={({ pressed }) => [
                  styles.authorRow,
                  index < topAuthors.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.cardBorder,
                  },
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                {author.thumbnail ? (
                  <FadeInImage
                    source={{ uri: author.thumbnail }}
                    style={styles.authorThumbnail}
                  />
                ) : (
                  <View
                    style={[
                      styles.authorInitial,
                      { backgroundColor: colors.activeBackground },
                    ]}
                  >
                    <ThemedText
                      style={[styles.authorInitialText, { color: colors.primary }]}
                      type="heading"
                    >
                      {author.author[0]?.toUpperCase() ?? "?"}
                    </ThemedText>
                  </View>
                )}
                <View style={styles.authorInfo}>
                  <ThemedText
                    style={[styles.authorName, { color: colors.primaryText }]}
                    type="label"
                    numberOfLines={1}
                  >
                    {author.author}
                  </ThemedText>
                  <ThemedText
                    style={[styles.authorMeta, { color: colors.secondaryText }]}
                    type="caption"
                  >
                    {formatCount(author.bookCount)} books
                    {author.avgRating
                      ? ` · ★ ${(author.avgRating / 10).toFixed(1)}`
                      : ""}
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.tertiaryText}
                />
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flex: 0,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    marginBottom: 4,
  },
  headerSubtitle: {},
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 8,
  },
  section: {
    marginBottom: 24,
  },
  genreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  genreCard: {
    width: "47%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
  },
  genreCount: {
    marginBottom: 4,
  },
  genreName: {
    textAlign: "center",
  },
  authorsCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  authorThumbnail: {
    width: 48,
    height: 64,
    borderRadius: 8,
  },
  authorInitial: {
    width: 48,
    height: 64,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  authorInitialText: {},
  authorInfo: {
    flex: 1,
    gap: 2,
  },
  authorName: {},
  authorMeta: {},
});
