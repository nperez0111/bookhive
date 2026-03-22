import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { FadeInImage } from "@/components/FadeInImage";
import { GradientView } from "@/components/GradientView";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useReadingStats } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

type BookSummary = {
  hiveId: string;
  title: string;
  authors: string;
  cover?: string;
  thumbnail?: string;
  pageCount?: number;
  rating?: number;
};

function MiniBookCard({ book, label, colors }: { book: BookSummary; label: string; colors: any }) {
  return (
    <Pressable
      onPress={() => router.push(`/book/${book.hiveId}` as any)}
      style={[
        styles.miniBookCard,
        { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
      ]}
    >
      <FadeInImage
        source={{
          uri: `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
        }}
        style={styles.miniBookCover}
      />
      <ThemedText type="overline" style={{ color: colors.secondaryText, marginTop: 6 }}>
        {label}
      </ThemedText>
      <ThemedText type="caption" style={{ color: colors.primaryText }} numberOfLines={2}>
        {book.title}
      </ThemedText>
    </Pressable>
  );
}

export default function ReadingStatsScreen() {
  const { did, handle } = useLocalSearchParams<{
    did: string;
    handle?: string;
  }>();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");

  const statsHandle = handle ?? did ?? "";
  const { data, isLoading, error, refetch } = useReadingStats(statsHandle, selectedYear);

  const stats = data?.stats;
  const availableYears = data?.availableYears ?? [currentYear];

  const ratingBuckets = stats
    ? [
        { label: "5★", value: stats.ratingDistribution.five },
        { label: "4★", value: stats.ratingDistribution.four },
        { label: "3★", value: stats.ratingDistribution.three },
        { label: "2★", value: stats.ratingDistribution.two },
        { label: "1★", value: stats.ratingDistribution.one },
      ]
    : [];
  const maxRating = Math.max(1, ...ratingBuckets.map((b) => b.value));

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <GradientView variant="warm" style={styles.header}>
        <BackNavigationHeader title="Reading Stats" />
      </GradientView>

      {/* Year Picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.yearPicker}
        contentContainerStyle={styles.yearPickerContent}
      >
        {availableYears.map((year) => (
          <Pressable
            key={year}
            onPress={() => setSelectedYear(year)}
            style={[
              styles.yearChip,
              {
                backgroundColor: year === selectedYear ? colors.primary : colors.inactiveBackground,
              },
            ]}
          >
            <ThemedText
              type="label"
              style={{
                color: year === selectedYear ? "#ffffff" : colors.secondaryText,
              }}
            >
              {year}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <QueryErrorHandler
          error={error}
          onRetry={() => refetch()}
          showRetryButton
          showGoBackButton={false}
        />
      ) : !stats || stats.booksCount === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.inactiveBackground }]}>
            <Ionicons name="book-outline" size={40} color={colors.tertiaryText} />
          </View>
          <ThemedText type="heading" style={[styles.emptyTitle, { color: colors.primaryText }]}>
            No books finished in {selectedYear}
          </ThemedText>
          <ThemedText type="body" style={{ color: colors.secondaryText, textAlign: "center" }}>
            Finish at least 3 books to see your Year in Books.
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Hero Stats */}
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: colors.cardBackground,
                borderColor: colors.cardBorder,
              },
            ]}
          >
            <ThemedText type="overline" style={[styles.heroYear, { color: colors.primary }]}>
              {selectedYear} Year in Books
            </ThemedText>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <ThemedText type="title" style={{ color: colors.primaryText }}>
                  {stats.booksCount}
                </ThemedText>
                <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                  Books
                </ThemedText>
              </View>
              <View style={[styles.heroDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.heroStat}>
                <ThemedText type="title" style={{ color: colors.primaryText }}>
                  {stats.pagesRead > 0 ? stats.pagesRead.toLocaleString() : "—"}
                </ThemedText>
                <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                  Pages
                </ThemedText>
              </View>
              <View style={[styles.heroDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.heroStat}>
                <ThemedText type="title" style={{ color: colors.primaryText }}>
                  {stats.averageRating ? (stats.averageRating / 10).toFixed(1) : "—"}
                </ThemedText>
                <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                  Avg ★
                </ThemedText>
              </View>
            </View>

          </View>

          {/* Rating Distribution */}
          {ratingBuckets.some((b) => b.value > 0) && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <ThemedText
                type="overline"
                style={[styles.cardTitle, { color: colors.secondaryText }]}
              >
                Rating Distribution
              </ThemedText>
              {ratingBuckets.map((bucket) => (
                <View key={bucket.label} style={styles.ratingRow}>
                  <ThemedText
                    type="caption"
                    style={[styles.ratingLabel, { color: colors.secondaryText }]}
                  >
                    {bucket.label}
                  </ThemedText>
                  <View
                    style={[styles.ratingTrack, { backgroundColor: colors.inactiveBackground }]}
                  >
                    <View
                      style={[
                        styles.ratingFill,
                        {
                          backgroundColor: colors.primary,
                          width: `${(bucket.value / maxRating) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText
                    type="caption"
                    style={[styles.ratingCount, { color: colors.tertiaryText }]}
                  >
                    {bucket.value}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}

          {/* Top Genres */}
          {stats.topGenres.length > 0 && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <ThemedText
                type="overline"
                style={[styles.cardTitle, { color: colors.secondaryText }]}
              >
                Top Genres
              </ThemedText>
              <View style={styles.genreChips}>
                {stats.topGenres.map((g) => (
                  <View
                    key={g.genre}
                    style={[styles.genreChip, { backgroundColor: colors.activeBackground }]}
                  >
                    <ThemedText type="caption" style={{ color: colors.primary }}>
                      {g.genre}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Bookends */}
          {(stats.firstBookOfYear || stats.lastBookOfYear) && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <ThemedText
                type="overline"
                style={[styles.cardTitle, { color: colors.secondaryText }]}
              >
                Bookends
              </ThemedText>
              <View style={styles.bookPair}>
                {stats.firstBookOfYear && (
                  <MiniBookCard book={stats.firstBookOfYear} label="First" colors={colors} />
                )}
                {stats.lastBookOfYear && (
                  <MiniBookCard book={stats.lastBookOfYear} label="Last" colors={colors} />
                )}
              </View>
            </View>
          )}

          {/* Longest / Shortest */}
          {(stats.longestBook || stats.shortestBook) && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <ThemedText
                type="overline"
                style={[styles.cardTitle, { color: colors.secondaryText }]}
              >
                Book Length
              </ThemedText>
              <View style={styles.bookPair}>
                {stats.longestBook && (
                  <MiniBookCard
                    book={stats.longestBook}
                    label={`Longest${stats.longestBook.pageCount ? ` · ${stats.longestBook.pageCount}p` : ""}`}
                    colors={colors}
                  />
                )}
                {stats.shortestBook && (
                  <MiniBookCard
                    book={stats.shortestBook}
                    label={`Shortest${stats.shortestBook.pageCount ? ` · ${stats.shortestBook.pageCount}p` : ""}`}
                    colors={colors}
                  />
                )}
              </View>
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  yearPicker: { maxHeight: 52 },
  yearPickerContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  yearChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { textAlign: "center" },
  scrollContent: { padding: 16, gap: 16 },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  heroYear: { marginBottom: 16 },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  heroStat: { alignItems: "center", flex: 1 },
  heroDivider: { width: 1, height: 40 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardTitle: { marginBottom: 4 },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ratingLabel: { width: 24 },
  ratingTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  ratingFill: { height: "100%", borderRadius: 4 },
  ratingCount: { width: 24, textAlign: "right" },
  genreChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  genreChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  bookPair: { flexDirection: "row", gap: 12 },
  miniBookCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
  },
  miniBookCover: { width: 72, height: 108, borderRadius: 8 },
});
