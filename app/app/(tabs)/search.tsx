import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  Animated,
} from "react-native";

// Create animated FlatList for scroll events
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<HiveBook>);
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { useProfile, useSearchBooks } from "@/hooks/useBookhiveQuery";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { router } from "expo-router";
import { useState, useRef } from "react";
import { getBaseUrl } from "@/context/auth";
import type { HiveBook } from "../../../src/types";
import { BOOK_STATUS } from "@/constants";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { FadeInImage } from "@/components/FadeInImage";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/Badge";
import { BookCard } from "@/components/BookCard";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const bottom = useBottomTabOverflow();

  const profile = useProfile();
  const { data: searchResults, isLoading, error } = useSearchBooks(query);

  // Animation values for collapsible header
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerHeight = 120; // Height of the full header
  const collapsedHeaderHeight = 80; // Height when collapsed

  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const headerTranslateY = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [0, -60],
    extrapolate: "clamp",
  });

  const searchInputTranslateY = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [0, -100],
    extrapolate: "clamp",
  });

  const renderSearchResultItem = ({
    item: book,
    index,
  }: {
    item: HiveBook;
    index: number;
  }) => (
    <AnimatedListItem index={index}>
      <BookCard
        title={book.title}
        authors={book.authors}
        imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`}
        onPress={() => router.push(`/book/${book.id}`)}
        orientation="horizontal"
        style={{ marginBottom: 12, alignItems: "center" }}
      />
    </AnimatedListItem>
  );

  const hasSearchResults =
    query.length > 0 && searchResults && searchResults.length > 0;

  return (
    <ThemedView
      style={[styles.container, { backgroundColor, paddingBottom: bottom }]}
    >
      {/* Fixed Search Input (always visible) */}
      <Animated.View
        style={[
          styles.fixedSearchContainer,
          {
            transform: [{ translateY: searchInputTranslateY }],
            zIndex: 1000,
          },
        ]}
      >
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

        {hasSearchResults && (
          <ThemedText
            style={[styles.resultCount, { color: colors.secondaryText }]}
            type="overline"
          >
            {searchResults?.length} results
          </ThemedText>
        )}
      </Animated.View>

      {/* Collapsible Header */}
      <Animated.View
        style={[
          styles.searchHeader,
          {
            opacity: headerOpacity,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}
      >
        <SectionHeader
          icon="search"
          title="Search"
          subtitle="Discover your next great read"
          style={{ paddingHorizontal: 0, paddingTop: 0, marginBottom: 8 }}
          right={
            hasSearchResults ? (
              <Badge label={`${searchResults?.length} results`} />
            ) : undefined
          }
        />
      </Animated.View>

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
            <AnimatedFlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchResultItem}
              contentContainerStyle={[
                styles.searchResultsList,
                { paddingBottom: 50 + bottom },
              ]}
              showsVerticalScrollIndicator={false}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                { useNativeDriver: true },
              )}
              scrollEventThrottle={16}
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
    paddingBottom: 16, // Reduced from 24
  },
  fixedSearchContainer: {
    position: "absolute",
    top: 140,
    left: 20,
    right: 20,
    zIndex: 1000,
  },
  searchTitle: {
    marginBottom: 8,
  },
  searchSubtitle: {
    lineHeight: 24,
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
    marginTop: 60,
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
    marginTop: 10,
  },
  horizontalListContent: {
    paddingHorizontal: 20,
  },
  searchResultsSection: {
    flex: 1,
  },
  searchResultsList: {
    paddingHorizontal: 20,
    paddingTop: 160,
    paddingBottom: 50,
  },
  searchResultItem: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    minHeight: 100,
  },
  coverContainer: {
    marginRight: 12,
    justifyContent: "center",
  },
  searchResultCover: {
    width: 65,
    height: 95,
    borderRadius: 10,
  },
  searchResultInfo: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 2,
  },
  searchResultTitle: {
    marginBottom: 4,
    lineHeight: 18,
    fontSize: 15,
  },
  searchResultAuthor: {
    marginBottom: 6,
    lineHeight: 16,
    fontSize: 13,
  },
  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  ratingText: {
    lineHeight: 16,
    fontSize: 12,
  },
  loadingContainer: {
    marginTop: 30,
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
