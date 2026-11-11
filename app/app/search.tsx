import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { useSearchBooks } from "@/hooks/useBookhiveQuery";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { useLanguage } from "@/context/language";
import { router } from "expo-router";
import { useState } from "react";
import { getBaseUrl } from "@/context/auth";
import type { HiveBook } from "../../src/types";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { InfinitePaginationFooter } from "@/components/InfinitePaginationFooter";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { BookCard } from "@/components/BookCard";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const top = useScreenTopInset();

  const { preferredLanguage } = useLanguage();
  const search = useSearchBooks(query, preferredLanguage);
  const { data: searchResults, isLoading, isDebouncing, error } = search;

  const renderSearchResultItem = ({ item: book, index }: { item: HiveBook; index: number }) => (
    <AnimatedListItem index={index}>
      <BookCard
        title={book.title}
        authors={book.authors}
        imageUri={
          book.cover || book.thumbnail
            ? `${getBaseUrl()}/images/s_300x500,fit_cover/${book.cover || book.thumbnail}`
            : ""
        }
        variant="row"
        rowSize="small"
        meta={
          book.rating
            ? `${(book.rating / 1000).toFixed(1)} · ${book.ratingsCount?.toLocaleString() || 0} ratings`
            : undefined
        }
        onPress={() => router.push(`/book/${book.id}`)}
      />
    </AnimatedListItem>
  );

  const hasSearchResults =
    !isDebouncing && query.trim().length > 0 && searchResults && searchResults.length > 0;

  return (
    <ThemedView
      style={[styles.container, { backgroundColor, paddingBottom: bottom, paddingTop: top }]}
    >
      <BackNavigationHeader
        title="Search books"
        onBackPress={() => (router.canGoBack() ? router.back() : router.navigate("/explore"))}
      />
      <View style={styles.searchControls}>
        <View
          style={[
            styles.searchInputWrapper,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.cardBorder,
            },
          ]}
        >
          <Ionicons
            name="search"
            size={20}
            color={colors.secondaryText}
            style={{ marginHorizontal: 12 }}
          />
          <TextInput
            style={[
              styles.searchInput,
              {
                color: colors.primaryText,
              },
            ]}
            accessibilityLabel="Search catalogue by title, author or ISBN"
            placeholder="Title, author or ISBN"
            placeholderTextColor={colors.placeholderText}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery("")}
              style={styles.clearButton}
            >
              <Ionicons name="close-circle" size={20} color={colors.tertiaryText} />
            </Pressable>
          )}
        </View>

        <View style={styles.metadataRow}>
          <ThemedText type="caption" style={{ color: colors.secondaryText, flexShrink: 1 }}>
            {preferredLanguage ? `Book language: ${preferredLanguage}` : "All book languages"}
          </ThemedText>
          {hasSearchResults && (
            <ThemedText
              style={[styles.resultCount, { color: colors.secondaryText }]}
              type="overline"
            >
              {searchResults?.length}
              {search.hasNextPage ? "+" : ""} results
            </ThemedText>
          )}
        </View>
      </View>

      {/* Content based on search state */}
      {query.trim().length === 0 ? (
        // No search query - show default content
        <View style={styles.emptySearchState}>
          <ThemedText
            style={[styles.emptySearchSubtitle, { color: colors.secondaryText }]}
            type="body"
          >
            Find your next book, or one you already read.
          </ThemedText>
        </View>
      ) : (
        // Has search query - show search results
        <View style={styles.searchResultsSection}>
          {isLoading || isDebouncing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <ThemedText style={[styles.loadingText, { color: colors.secondaryText }]} type="body">
                Searching for books...
              </ThemedText>
            </View>
          ) : error && !searchResults?.length ? (
            <QueryErrorHandler
              error={error}
              onRetry={() => search.refetch()}
              showRetryButton
              showGoBackButton={false}
            />
          ) : searchResults && searchResults.length > 0 ? (
            <FlatList
              key={`${query.trim()}:${preferredLanguage ?? ""}`}
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchResultItem}
              contentContainerStyle={[styles.searchResultsList, { paddingBottom: 50 + bottom }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListFooterComponent={<InfinitePaginationFooter {...search} />}
            />
          ) : (
            <View style={styles.emptyState}>
              <View
                style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}
              >
                <Ionicons name="search-outline" size={32} color={colors.tertiaryText} />
              </View>
              <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
                No books found
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: colors.secondaryText }]}
                type="body"
              >
                Check the spelling or try a title, author or ISBN.
              </ThemedText>
            </View>
          )}
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchControls: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
  },
  clearButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  resultCount: {
    textAlign: "right",
    flexShrink: 1,
  },
  metadataRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
  searchResultsSection: {
    flex: 1,
  },
  searchResultsList: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 50,
  },
  loadingContainer: {
    marginTop: 40,
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
  },
  emptyState: {
    paddingVertical: 80,
    alignItems: "center",
    paddingHorizontal: 20,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    textAlign: "center",
    lineHeight: 20,
  },
  emptySearchState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptySearchSubtitle: {
    textAlign: "center",
    lineHeight: 24,
  },
});
