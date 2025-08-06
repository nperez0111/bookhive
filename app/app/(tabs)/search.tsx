import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useProfile, useSearchBooks } from "@/hooks/useBookhiveQuery";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { router } from "expo-router";
import { useState } from "react";
import { getBaseUrl } from "@/context/auth";
import type { HiveBook } from "../../../src/types";
import { BOOK_STATUS } from "@/constants";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  const profile = useProfile();
  const { data: searchResults, isLoading, error } = useSearchBooks(query);

  const renderSearchResultItem = ({ item: book }: { item: HiveBook }) => (
    <Pressable
      onPress={() => router.push(`/book/${book.id}`)}
      style={[
        styles.searchResultItem,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.cardBorder,
          shadowColor: colors.shadowLight,
        },
      ]}
    >
      <View style={styles.coverContainer}>
        <Image
          source={{
            uri: `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
          }}
          style={styles.searchResultCover}
          resizeMode="cover"
        />
      </View>
      <View style={styles.searchResultInfo}>
        <ThemedText
          style={[styles.searchResultTitle, { color: colors.primaryText }]}
          numberOfLines={2}
          type="label"
        >
          {book.title}
        </ThemedText>
        <ThemedText
          style={[styles.searchResultAuthor, { color: colors.secondaryText }]}
          numberOfLines={1}
          type="caption"
        >
          {book.authors}
        </ThemedText>
        {book.rating && (
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={14} color={colors.primary} />
            <ThemedText
              style={[styles.ratingText, { color: colors.secondaryText }]}
              type="caption"
            >
              {book.rating / 1000} ({book.ratingsCount?.toLocaleString() || 0}{" "}
              ratings)
            </ThemedText>
          </View>
        )}
      </View>
    </Pressable>
  );

  const hasSearchResults =
    query.length > 0 && searchResults && searchResults.length > 0;

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      {/* Search Header */}
      <View style={styles.searchHeader}>
        <ThemedText
          style={[styles.searchTitle, { color: colors.primaryText }]}
          type="title"
        >
          Search Books
        </ThemedText>
        <ThemedText
          style={[styles.searchSubtitle, { color: colors.secondaryText }]}
          type="body"
        >
          Discover your next great read
        </ThemedText>
      </View>

      {/* Search Input */}
      <View style={styles.searchInputContainer}>
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
            color={colors.tertiaryText}
            style={styles.searchIcon}
          />
          <TextInput
            style={[
              styles.searchInput,
              {
                color: colors.primaryText,
              },
            ]}
            placeholder="Search for books, authors, or genres..."
            placeholderTextColor={colors.placeholderText}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} style={styles.clearButton}>
              <Ionicons
                name="close-circle"
                size={20}
                color={colors.tertiaryText}
              />
            </Pressable>
          )}
        </View>
      </View>

      {/* Content based on search state */}
      {query.length === 0 ? (
        // No search query - show default content
        <View style={styles.emptySearchState}>
          <View
            style={[
              styles.emptyIconContainer,
              { backgroundColor: colors.inactiveBackground },
            ]}
          >
            <Ionicons
              name="library-outline"
              size={48}
              color={colors.tertiaryText}
            />
          </View>
          <ThemedText
            style={[styles.emptySearchTitle, { color: colors.primaryText }]}
            type="heading"
          >
            Start exploring
          </ThemedText>
          <ThemedText
            style={[
              styles.emptySearchSubtitle,
              { color: colors.secondaryText },
            ]}
            type="body"
          >
            Search for your favorite books, authors, or genres to discover new
            reads
          </ThemedText>
        </View>
      ) : (
        // Has search query - show search results
        <View style={styles.searchResultsSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderContent}>
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: colors.activeBackground },
                ]}
              >
                <Ionicons name="search" size={20} color={colors.primary} />
              </View>
              <ThemedText
                style={[styles.sectionTitle, { color: colors.primaryText }]}
                type="heading"
              >
                Search Results
              </ThemedText>
            </View>
            {searchResults && (
              <ThemedText
                style={[styles.resultCount, { color: colors.secondaryText }]}
                type="caption"
                numberOfLines={1}
              >
                {searchResults.length} results
              </ThemedText>
            )}
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <ThemedText
                style={[styles.loadingText, { color: colors.secondaryText }]}
                type="body"
              >
                Searching for books...
              </ThemedText>
            </View>
          ) : error ? (
            <QueryErrorHandler
              error={error}
              onRetry={() => {}} // Search will retry automatically
              showRetryButton={false}
              showGoBackButton={false}
            />
          ) : searchResults && searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchResultItem}
              contentContainerStyle={styles.searchResultsList}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View style={styles.emptyState}>
              <View
                style={[
                  styles.emptyIconContainer,
                  { backgroundColor: colors.inactiveBackground },
                ]}
              >
                <Ionicons
                  name="search-outline"
                  size={32}
                  color={colors.tertiaryText}
                />
              </View>
              <ThemedText
                style={[styles.emptyTitle, { color: colors.primaryText }]}
                type="heading"
              >
                No books found
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: colors.secondaryText }]}
                type="body"
              >
                Try searching with different keywords
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
  searchHeader: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  searchTitle: {
    marginBottom: 8,
  },
  searchSubtitle: {
    lineHeight: 24,
  },
  searchInputContainer: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
  },
  clearButton: {
    marginLeft: 8,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 12,
  },
  sectionHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
  },
  resultCount: {
    textAlign: "right",
    flexShrink: 0,
  },
  horizontalListContent: {
    paddingHorizontal: 20,
  },
  searchResultsSection: {
    flex: 1,
  },
  searchResultsList: {
    paddingHorizontal: 20,
  },
  searchResultItem: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  coverContainer: {
    marginRight: 16,
  },
  searchResultCover: {
    width: 60,
    height: 90,
    borderRadius: 8,
  },
  searchResultInfo: {
    flex: 1,
    justifyContent: "center",
  },
  searchResultTitle: {
    marginBottom: 4,
    lineHeight: 18,
  },
  searchResultAuthor: {
    marginBottom: 8,
    lineHeight: 16,
  },
  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    lineHeight: 16,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
  },
  emptyState: {
    paddingVertical: 40,
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
  emptySearchTitle: {
    marginBottom: 16,
    textAlign: "center",
  },
  emptySearchSubtitle: {
    textAlign: "center",
    lineHeight: 24,
  },
});
