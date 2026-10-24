import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionSheet } from "@/components/ActionSheet";
import { BookCard } from "@/components/BookCard";
import { StarDisplay } from "@/components/StarDisplay";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useProfile, useUpdateBook } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import {
  displayAuthors,
  matchesTrackedFilter,
  selectTrackedBooks,
  trackedStatusLabel,
  TRACKED_FILTERS,
  TRACKED_SORTS,
  type SortDirection,
  type TrackedFilter,
  type TrackedSort,
} from "@/utils/trackedBooks";
import { isHiveId } from "../../../src/core/hiveId";
import { starsToDisplayRating } from "../../../src/core/rating";
import type { UserBook } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

function TrackedBookItem({
  book,
  grid,
  onError,
}: {
  book: UserBook;
  grid: boolean;
  onError: (message: string | null) => void;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  const update = useUpdateBook();
  const image = book.cover || book.thumbnail;
  const toggleOwned = async () => {
    if (!isHiveId(book.hiveId)) {
      onError("This book has an invalid identifier. Refresh your books and try again.");
      return;
    }
    onError(null);
    try {
      await update.mutateAsync({ hiveId: book.hiveId, owned: !book.owned });
    } catch (error) {
      // Keep feedback outside the row: the Owned filter can unmount it optimistically.
      onError(
        `Could not update “${book.title}”: ${error instanceof Error ? error.message : "Please try again."}`,
      );
    }
  };
  return (
    <View
      style={[
        styles.card,
        grid ? styles.gridCard : styles.listCard,
        { backgroundColor: colors.cardBackground, shadowColor: colors.shadowMedium },
      ]}
    >
      <BookCard
        title={book.title || "Untitled book"}
        authors={displayAuthors(book.authors) || "Unknown author"}
        imageUri={image ? `${getBaseUrl()}/images/s_300x450,fit_cover/${image}` : ""}
        onPress={() => router.push(`/book/${book.hiveId}`)}
        variant={grid ? "dense" : "row"}
        rowSize="small"
        meta={trackedStatusLabel(book.status)}
      >
        {book.stars != null && book.stars > 0 && (
          <View style={styles.rating}>
            <StarDisplay rating={book.stars} />
            <ThemedText type="caption" style={styles.number}>
              {starsToDisplayRating(book.stars)}
            </ThemedText>
          </View>
        )}
      </BookCard>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={`Own ${book.title}`}
        accessibilityState={{
          checked: book.owned === true,
          disabled: update.isPending,
          busy: update.isPending,
        }}
        disabled={update.isPending}
        onPress={() => void toggleOwned()}
        style={({ pressed }) => [
          styles.owned,
          {
            backgroundColor: book.owned ? colors.activeBackground : colors.inactiveBackground,
            opacity: pressed || update.isPending ? 0.65 : 1,
          },
        ]}
      >
        {update.isPending ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons
            name={book.owned ? "checkmark-circle" : "add-circle-outline"}
            size={18}
            color={book.owned ? colors.primary : colors.secondaryText}
          />
        )}
        <ThemedText
          type="caption"
          style={{ color: book.owned ? colors.primary : colors.secondaryText }}
        >
          {book.owned ? "Owned" : "Mark owned"}
        </ThemedText>
      </Pressable>
    </View>
  );
}

export default function MyBooksScreen() {
  const colors = Colors[useColorScheme() ?? "light"];
  const { top } = useSafeAreaInsets();
  const bottom = useBottomTabOverflow();
  const profile = useProfile();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TrackedFilter>("all");
  const [sort, setSort] = useState<TrackedSort>("dateAdded");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [grid, setGrid] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const books = profile.data?.books;
  const filtered = useMemo(
    () => selectTrackedBooks(books ?? [], { query, filter, sort, direction }),
    [books, query, filter, sort, direction],
  );
  const counts = useMemo(
    () =>
      new Map(
        TRACKED_FILTERS.map(({ key }) => [
          key,
          (books ?? []).filter((book) => matchesTrackedFilter(book, key)).length,
        ]),
      ),
    [books],
  );

  if (profile.isLoading)
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText>Loading your books…</ThemedText>
      </View>
    );
  if (profile.error && !profile.data)
    return (
      <QueryErrorHandler error={profile.error} onRetry={() => profile.refetch()} showRetryButton />
    );

  const clearFilters = () => {
    setQuery("");
    setFilter("all");
  };
  return (
    <View style={[styles.screen, { paddingTop: top, backgroundColor: colors.background }]}>
      <View style={styles.heading}>
        <ThemedText type="title">My Books</ThemedText>
        <ThemedText type="body" style={{ color: colors.secondaryText }}>
          Your reading, all in one place.
        </ThemedText>
      </View>
      <View
        style={[
          styles.search,
          { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
        ]}
      >
        <Ionicons name="search-outline" size={20} color={colors.secondaryText} />
        <ThemedTextInput
          accessibilityLabel="Search your books by title or author"
          placeholder="Search title or author"
          placeholderTextColor={colors.secondaryText}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.input}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery("")}
            style={styles.iconButton}
          >
            <Ionicons name="close-circle" size={20} color={colors.secondaryText} />
          </Pressable>
        )}
      </View>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          keyboardShouldPersistTaps="handled"
        >
          {TRACKED_FILTERS.map(({ key, label }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}
              onPress={() => setFilter(key)}
              style={({ pressed }) => [
                styles.pill,
                {
                  backgroundColor: filter === key ? colors.primary : colors.cardBackground,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <ThemedText
                type="caption"
                style={{ color: filter === key ? colors.background : colors.primaryText }}
              >
                {label}
              </ThemedText>
              <ThemedText
                type="caption"
                style={[
                  styles.number,
                  { color: filter === key ? colors.background : colors.secondaryText },
                ]}
              >
                {counts.get(key)}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={styles.toolbar}>
        <ThemedText type="caption" style={[styles.number, { color: colors.secondaryText }]}>
          {filtered.length} {filtered.length === 1 ? "book" : "books"}
        </ThemedText>
        <View style={styles.toolbarActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${TRACKED_SORTS.find(({ key }) => key === sort)?.label}`}
            onPress={() => setSortOpen(true)}
            style={styles.sortButton}
          >
            <ThemedText type="caption">
              {TRACKED_SORTS.find(({ key }) => key === sort)?.label}
            </ThemedText>
            <Ionicons name="chevron-down" size={14} color={colors.secondaryText} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              direction === "asc"
                ? "Ascending, change to descending"
                : "Descending, change to ascending"
            }
            onPress={() => setDirection(direction === "asc" ? "desc" : "asc")}
            style={styles.iconButton}
          >
            <Ionicons
              name={direction === "asc" ? "arrow-up" : "arrow-down"}
              size={20}
              color={colors.primary}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={grid ? "Switch to list view" : "Switch to grid view"}
            onPress={() => setGrid(!grid)}
            style={styles.iconButton}
          >
            <Ionicons
              name={grid ? "list-outline" : "grid-outline"}
              size={20}
              color={colors.primary}
            />
          </Pressable>
        </View>
      </View>
      {profile.error && (
        <ThemedText
          accessibilityRole="alert"
          type="caption"
          style={[styles.error, { color: colors.error }]}
        >
          Could not refresh your books. Pull down to try again.
        </ThemedText>
      )}
      {writeError && (
        <View style={styles.errorRow}>
          <ThemedText
            accessibilityRole="alert"
            type="caption"
            style={[styles.errorText, { color: colors.error }]}
          >
            {writeError}
          </ThemedText>
          <Pressable
            onPress={() => setWriteError(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss update error"
            style={styles.iconButton}
          >
            <Ionicons name="close" size={20} color={colors.error} />
          </Pressable>
        </View>
      )}
      <FlatList
        key={grid ? "grid" : "list"}
        data={filtered}
        numColumns={grid ? 2 : 1}
        columnWrapperStyle={grid ? styles.gridRow : undefined}
        keyExtractor={(book) => book.hiveId}
        renderItem={({ item }) => (
          <TrackedBookItem book={item} grid={grid} onError={setWriteError} />
        )}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottom + 24 },
          filtered.length === 0 && styles.emptyContent,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => {
              setRefreshing(true);
              void profile.refetch().finally(() => setRefreshing(false));
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name={books?.length ? "search-outline" : "library-outline"}
              size={42}
              color={colors.primary}
            />
            <ThemedText type="heading">
              {books?.length ? "No matching books" : "Make room for your next read"}
            </ThemedText>
            <ThemedText style={styles.emptyDescription}>
              {books?.length
                ? "Try a different title, author, or reading status."
                : "Find a book and add it to your reading list to get started."}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={books?.length ? clearFilters : () => router.push("/search")}
              style={[styles.emptyButton, { backgroundColor: colors.primary }]}
            >
              <ThemedText type="label" style={{ color: colors.background }}>
                {books?.length ? "Clear filters" : "Find books"}
              </ThemedText>
            </Pressable>
          </View>
        }
      />
      <ActionSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        title="Sort your books"
        subtitle="Missing dates and unrated books appear last."
        actions={TRACKED_SORTS.map(({ key, label }) => ({
          key,
          label,
          icon: sort === key ? "checkmark-circle" : "ellipse-outline",
          onPress: () => {
            setSort(key);
            setDirection(key === "title" || key === "author" ? "asc" : "desc");
            setSortOpen(false);
          },
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  heading: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 4 },
  search: {
    marginHorizontal: 16,
    paddingLeft: 14,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    backgroundColor: "transparent",
    fontSize: 16,
  },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  filters: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },
  pill: {
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  number: { fontVariant: ["tabular-nums"] },
  toolbar: {
    paddingLeft: 20,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
  toolbarActions: { flexDirection: "row", alignItems: "center" },
  sortButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  content: { paddingHorizontal: 16, gap: 12 },
  gridRow: { gap: 12, alignItems: "stretch" },
  card: {
    borderRadius: 18,
    padding: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  listCard: { width: "100%" },
  gridCard: { width: "48%", flexShrink: 1 },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  owned: {
    minHeight: 42,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  error: { paddingHorizontal: 20, paddingBottom: 12 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 8,
    paddingBottom: 8,
  },
  errorText: { flex: 1 },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  emptyDescription: { textAlign: "center" },
  emptyButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
});
