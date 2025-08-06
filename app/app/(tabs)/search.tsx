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
          backgroundColor:
            colorScheme === "dark"
              ? "rgba(255, 255, 255, 0.05)"
              : "rgba(0, 0, 0, 0.08)",
          borderColor:
            colorScheme === "dark"
              ? "rgba(255, 255, 255, 0.1)"
              : "rgba(0, 0, 0, 0.15)",
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
          style={[
            styles.searchResultTitle,
            { color: colorScheme === "dark" ? "white" : colors.text },
          ]}
          numberOfLines={2}
        >
          {book.title}
        </ThemedText>
        <ThemedText
          style={[
            styles.searchResultAuthor,
            { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
          ]}
          numberOfLines={1}
        >
          {book.authors}
        </ThemedText>
        {book.rating && (
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={14} color={colors.primary} />
            <ThemedText
              style={[
                styles.ratingText,
                { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
              ]}
            >
              {book.rating / 1000} ({book.ratingsCount?.toLocaleString() || 0}{" "}
              ratings)
            </ThemedText>
          </View>
        )}
      </View>
    </Pressable>
  );

  const renderCurrentlyReadingItem = ({ item: book }: { item: any }) => (
    <Pressable
      onPress={() => router.push(`/book/${book.hiveId}`)}
      style={[
        styles.currentlyReadingCard,
        {
          backgroundColor:
            colorScheme === "dark"
              ? "rgba(255, 255, 255, 0.05)"
              : "rgba(0, 0, 0, 0.08)",
          borderColor:
            colorScheme === "dark"
              ? "rgba(255, 255, 255, 0.1)"
              : "rgba(0, 0, 0, 0.15)",
        },
      ]}
    >
      <View style={styles.coverContainer}>
        <Image
          source={{
            uri: `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
          }}
          style={styles.currentlyReadingCover}
          resizeMode="cover"
        />
      </View>
      <View style={styles.bookInfo}>
        <ThemedText
          style={[
            styles.currentlyReadingTitle,
            { color: colorScheme === "dark" ? "white" : colors.text },
          ]}
          numberOfLines={2}
        >
          {book.title}
        </ThemedText>
        <ThemedText
          style={[
            styles.currentlyReadingAuthor,
            { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
          ]}
          numberOfLines={1}
        >
          {book.authors}
        </ThemedText>
      </View>
    </Pressable>
  );

  const currentlyReadingBooks =
    profile.data?.books.filter((book) => book.status === BOOK_STATUS.READING) ||
    [];

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerSection}>
          <ThemedText
            style={[
              styles.headerTitle,
              { color: colorScheme === "dark" ? "white" : colors.text },
            ]}
          >
            Discover Books
          </ThemedText>
          <ThemedText
            style={[
              styles.headerSubtitle,
              { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
            ]}
          >
            Search for your next great read
          </ThemedText>
        </View>

        {/* Search Bar */}
        <View style={styles.searchSection}>
          <View
            style={[
              styles.searchContainer,
              {
                backgroundColor:
                  colorScheme === "dark"
                    ? "rgba(255, 255, 255, 0.05)"
                    : "rgba(0, 0, 0, 0.08)",
                borderColor:
                  colorScheme === "dark"
                    ? "rgba(255, 255, 255, 0.1)"
                    : "rgba(0, 0, 0, 0.15)",
              },
            ]}
          >
            <Ionicons
              name="search"
              size={20}
              color={colorScheme === "dark" ? "#9CA3AF" : "#6B7280"}
              style={styles.searchIcon}
            />
            <TextInput
              style={[
                styles.searchBox,
                { color: colorScheme === "dark" ? "white" : colors.text },
              ]}
              placeholder="Search for books, authors, or genres..."
              placeholderTextColor={
                colorScheme === "dark" ? "#9CA3AF" : "#6B7280"
              }
              value={query}
              onChangeText={setQuery}
              autoComplete="off"
              clearButtonMode="while-editing"
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Content */}
        {!query && (
          <>
            {/* Currently Reading Section */}
            {currentlyReadingBooks.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionHeaderContent}>
                    <Ionicons
                      name="bookmark"
                      size={24}
                      color={colors.primary}
                    />
                    <ThemedText
                      style={[
                        styles.sectionTitle,
                        {
                          color: colorScheme === "dark" ? "white" : colors.text,
                        },
                      ]}
                    >
                      Continue Reading
                    </ThemedText>
                  </View>
                </View>

                <FlatList
                  data={currentlyReadingBooks}
                  renderItem={renderCurrentlyReadingItem}
                  keyExtractor={(item) => item.hiveId}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalListContent}
                />
              </View>
            )}

            {/* Empty State */}
            {currentlyReadingBooks.length === 0 && (
              <View style={styles.emptyStateSection}>
                <View
                  style={[
                    styles.emptyState,
                    {
                      backgroundColor:
                        colorScheme === "dark"
                          ? "rgba(255, 255, 255, 0.05)"
                          : "rgba(0, 0, 0, 0.08)",
                      borderColor:
                        colorScheme === "dark"
                          ? "rgba(255, 255, 255, 0.1)"
                          : "rgba(0, 0, 0, 0.15)",
                    },
                  ]}
                >
                  <Ionicons
                    name="search-outline"
                    size={64}
                    color={colorScheme === "dark" ? "#9CA3AF" : "#6B7280"}
                  />
                  <ThemedText
                    style={[
                      styles.emptyTitle,
                      { color: colorScheme === "dark" ? "white" : colors.text },
                    ]}
                  >
                    Start Your Search
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.emptySubtitle,
                      { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                    ]}
                  >
                    Search for books by title, author, or genre to discover your
                    next great read
                  </ThemedText>
                </View>
              </View>
            )}
          </>
        )}

        {/* Search Results */}
        {query && (
          <View style={styles.searchResultsSection}>
            {isLoading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <ThemedText
                  style={[
                    styles.loadingText,
                    { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                  ]}
                >
                  Searching for "{query}"...
                </ThemedText>
              </View>
            )}

            {error && (
              <QueryErrorHandler
                error={error}
                onRetry={() => {}} // The search will retry automatically
                showRetryButton={false}
                showGoBackButton={false}
              />
            )}

            {searchResults && searchResults.length > 0 && !isLoading && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionHeaderContent}>
                    <Ionicons name="library" size={24} color={colors.primary} />
                    <ThemedText
                      style={[
                        styles.sectionTitle,
                        {
                          color: colorScheme === "dark" ? "white" : colors.text,
                        },
                      ]}
                    >
                      Search Results
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={[
                      styles.resultCount,
                      { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                    ]}
                  >
                    {searchResults.length}{" "}
                    {searchResults.length === 1 ? "book" : "books"}
                  </ThemedText>
                </View>

                <View style={styles.searchResultsList}>
                  {searchResults.map((book) => (
                    <View key={book.id}>
                      {renderSearchResultItem({ item: book })}
                    </View>
                  ))}
                </View>
              </>
            )}

            {searchResults &&
              searchResults.length === 0 &&
              !isLoading &&
              query.length > 0 && (
                <View style={styles.noResultsSection}>
                  <View
                    style={[
                      styles.emptyState,
                      {
                        backgroundColor:
                          colorScheme === "dark"
                            ? "rgba(255, 255, 255, 0.05)"
                            : "rgba(0, 0, 0, 0.08)",
                        borderColor:
                          colorScheme === "dark"
                            ? "rgba(255, 255, 255, 0.1)"
                            : "rgba(0, 0, 0, 0.15)",
                      },
                    ]}
                  >
                    <Ionicons
                      name="search-outline"
                      size={64}
                      color={colorScheme === "dark" ? "#9CA3AF" : "#6B7280"}
                    />
                    <ThemedText
                      style={[
                        styles.emptyTitle,
                        {
                          color: colorScheme === "dark" ? "white" : colors.text,
                        },
                      ]}
                    >
                      No books found
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.emptySubtitle,
                        {
                          color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280",
                        },
                      ]}
                    >
                      No books found for "{query}". Try a different search term.
                    </ThemedText>
                  </View>
                </View>
              )}
          </View>
        )}

        {/* Bottom spacing */}
        <View style={styles.bottomSpacing} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    lineHeight: 36,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  searchSection: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchBox: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
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
  },
  sectionHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
  },
  resultCount: {
    fontSize: 14,
  },
  horizontalListContent: {
    paddingHorizontal: 20,
  },
  currentlyReadingCard: {
    borderRadius: 16,
    padding: 12,
    marginRight: 16,
    width: 140,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  coverContainer: {
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  currentlyReadingCover: {
    width: 100,
    height: 150,
    borderRadius: 8,
  },
  bookInfo: {
    flex: 1,
  },
  currentlyReadingTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
    lineHeight: 18,
  },
  currentlyReadingAuthor: {
    fontSize: 12,
    lineHeight: 16,
  },
  emptyStateSection: {
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  emptyState: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  searchResultsSection: {
    flex: 1,
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: "center",
  },
  noResultsSection: {
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  searchResultsList: {
    paddingHorizontal: 20,
  },
  searchResultItem: {
    flexDirection: "row",
    padding: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchResultCover: {
    width: 80,
    height: 120,
    borderRadius: 8,
  },
  searchResultInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: "space-between",
  },
  searchResultTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
    lineHeight: 20,
  },
  searchResultAuthor: {
    fontSize: 14,
    marginBottom: 8,
    lineHeight: 18,
  },
  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
  },
  bottomSpacing: {
    height: 20,
  },
});
