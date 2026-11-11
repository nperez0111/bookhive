import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { ActionSheet } from "@/components/ActionSheet";
import { TrackedBookItem } from "./TrackedBookItem";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import {
  matchesTrackedFilter,
  selectTrackedBooks,
  TRACKED_FILTERS,
  TRACKED_SORTS,
  type SortDirection,
  type TrackedFilter,
  type TrackedSort,
} from "@/utils/trackedBooks";

export function TrackedBooksContent() {
  const colors = Colors[useColorScheme() ?? "light"];
  const bottom = useBottomTabOverflow();
  const profile = useProfile();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TrackedFilter>("all");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [sort, setSort] = useState<TrackedSort>("dateAdded");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [grid, setGrid] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const books = profile.data?.books;
  const filtered = useMemo(
    () =>
      selectTrackedBooks(books ?? [], { query, filter, sort, direction }).filter(
        (book) => !ownedOnly || book.owned,
      ),
    [books, query, filter, sort, direction, ownedOnly],
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
    setOwnedOnly(false);
  };
  return (
    <View style={styles.screen}>
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
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter your books"
          onPress={() => setFilterOpen(true)}
          style={styles.sortButton}
        >
          <ThemedText type="caption" style={[styles.number, styles.toolbarLabel]}>
            {TRACKED_FILTERS.find(({ key }) => key === filter)?.label}
            {ownedOnly ? " · Owned" : ""} · {filtered.length}
          </ThemedText>
          <Ionicons name="chevron-down" size={14} color={colors.secondaryText} />
        </Pressable>
        <View style={styles.toolbarActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${TRACKED_SORTS.find(({ key }) => key === sort)?.label}`}
            onPress={() => setSortOpen(true)}
            style={styles.sortButton}
          >
            <ThemedText type="caption" style={styles.toolbarLabel}>
              {TRACKED_SORTS.find(({ key }) => key === sort)?.label}
            </ThemedText>
            <Ionicons name="chevron-down" size={14} color={colors.secondaryText} />
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
        actions={[
          ...TRACKED_SORTS.map(({ key, label }) => ({
            key,
            label,
            selected: sort === key,
            icon: sort === key ? ("checkmark-circle" as const) : ("ellipse-outline" as const),
            onPress: () => {
              setSort(key);
              setDirection(key === "title" || key === "author" ? "asc" : "desc");
              setSortOpen(false);
            },
          })),
          {
            key: "direction",
            label: direction === "asc" ? "Ascending order" : "Descending order",
            icon: direction === "asc" ? "arrow-up" : "arrow-down",
            onPress: () => {
              setDirection(direction === "asc" ? "desc" : "asc");
              setSortOpen(false);
            },
          },
        ]}
      />
      <ActionSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter your books"
        actions={[
          ...TRACKED_FILTERS.filter(({ key }) => key !== "owned").map(({ key, label }) => ({
            key,
            label: `${label} (${counts.get(key)})`,
            selected: filter === key,
            icon: "ellipse-outline" as const,
            onPress: () => {
              setFilter(key);
              setFilterOpen(false);
            },
          })),
          {
            key: "owned",
            label: ownedOnly ? "Show owned and unowned" : "Only books I own",
            icon: "book-outline",
            description: "Applies alongside your reading status",
            onPress: () => {
              setOwnedOnly(!ownedOnly);
              setFilterOpen(false);
            },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
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
  number: { fontVariant: ["tabular-nums"] },
  toolbar: {
    paddingLeft: 20,
    paddingRight: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
  toolbarActions: { flexDirection: "row", alignItems: "center", maxWidth: "100%" },
  toolbarLabel: { flexShrink: 1 },
  sortButton: {
    maxWidth: "100%",
    flexShrink: 1,
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  content: { paddingHorizontal: 20, gap: 0 },
  gridRow: { gap: 12, alignItems: "stretch" },
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
