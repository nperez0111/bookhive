import { AnimatedListItem } from "@/components/AnimatedListItem";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { FadeInImage } from "@/components/FadeInImage";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { BOOK_STATUS } from "@/constants";
import { getBaseUrl } from "@/context/auth";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { UserBook } from "../../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

const STATUS_CONFIG = {
  reading: {
    title: "Currently Reading",
    icon: "book-outline",
    emptyMessage: "No books in progress",
    emptySubtitle: "Start reading a book to see it here",
    status: BOOK_STATUS.READING,
  },
  wantToRead: {
    title: "Want to Read",
    icon: "bookmark-outline",
    emptyMessage: "No books in your list",
    emptySubtitle: "Add books to your reading list",
    status: BOOK_STATUS.WANTTOREAD,
  },
  finished: {
    title: "Finished",
    icon: "checkmark-circle-outline",
    emptyMessage: "No finished books",
    emptySubtitle: "Complete a book to see it here",
    status: BOOK_STATUS.FINISHED,
  },
  abandoned: {
    title: "Abandoned",
    icon: "close-circle-outline",
    emptyMessage: "No abandoned books",
    emptySubtitle: "Books you've stopped reading will appear here",
    status: BOOK_STATUS.ABANDONED,
  },
  owned: {
    title: "Owned",
    icon: "library-outline",
    emptyMessage: "No owned books",
    emptySubtitle: "Books you own will appear here",
    status: "owned",
  },
};

type SortBy = "dateAdded" | "dateRead" | "title" | "author";
type SortOrder = "asc" | "desc";

const sortBooks = (
  books: UserBook[],
  sortBy: SortBy,
  sortOrder: SortOrder,
  bookStatus: string,
): UserBook[] => {
  const sorted = [...books].sort((a, b) => {
    let aValue: string | number | null = null;
    let bValue: string | number | null = null;

    switch (sortBy) {
      case "dateAdded":
        aValue = a.createdAt ? new Date(a.createdAt).getTime() : null;
        bValue = b.createdAt ? new Date(b.createdAt).getTime() : null;
        break;
      case "dateRead":
        if (bookStatus === BOOK_STATUS.FINISHED) {
          aValue = a.finishedAt ? new Date(a.finishedAt).getTime() : null;
          bValue = b.finishedAt ? new Date(b.finishedAt).getTime() : null;
        } else {
          aValue = a.startedAt ? new Date(a.startedAt).getTime() : null;
          bValue = b.startedAt ? new Date(b.startedAt).getTime() : null;
        }
        break;
      case "title":
        aValue = a.title?.toLowerCase() || "";
        bValue = b.title?.toLowerCase() || "";
        break;
      case "author":
        aValue = a.authors?.toLowerCase() || "";
        bValue = b.authors?.toLowerCase() || "";
        break;
    }

    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;

    let comparison = 0;
    if (aValue < bValue) comparison = -1;
    if (aValue > bValue) comparison = 1;

    return sortOrder === "asc" ? comparison : -comparison;
  });

  return sorted;
};

function FilteredBooksContent({ status, did }: { status: string; did?: string }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const [sortBy, setSortBy] = useState<SortBy>("dateAdded");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);

  const profile = useProfile(did);

  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];

  const statusBooks = useMemo(() => {
    if (!profile.data) return [];
    return config.status === "owned"
      ? profile.data.books.filter((book: any) => book.owned)
      : profile.data.books.filter((book) => book.status === config.status);
  }, [profile.data, config.status]);

  const availableGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of statusBooks) {
      const genres = (book as any).genres as string[] | undefined;
      if (!genres) continue;
      for (const genre of genres) {
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([genre, count]) => ({ genre, count }));
  }, [statusBooks]);

  const activeGenre =
    selectedGenre && availableGenres.some((g) => g.genre === selectedGenre) ? selectedGenre : null;

  const filteredBooks = useMemo(() => {
    const genreFiltered = activeGenre
      ? statusBooks.filter((book) => {
          const genres = (book as any).genres as string[] | undefined;
          return genres?.includes(activeGenre);
        })
      : statusBooks;
    return sortBooks(genreFiltered, sortBy, sortOrder, config.status);
  }, [statusBooks, activeGenre, sortBy, sortOrder, config.status]);

  if (profile.isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText style={[styles.loadingText, { color: colors.secondaryText }]} type="body">
          Loading books...
        </ThemedText>
      </View>
    );
  }

  if (profile.error) {
    return (
      <QueryErrorHandler
        error={profile.error}
        onRetry={() => profile.refetch()}
        onGoBack={() => router.back()}
        showRetryButton={true}
        showGoBackButton={true}
      />
    );
  }

  if (!config) {
    return (
      <View style={[styles.errorContainer, { backgroundColor }]}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.primary} />
        <ThemedText style={[styles.errorTitle, { color: colors.primaryText }]} type="heading">
          Invalid Status
        </ThemedText>
        <ThemedText style={[styles.errorMessage, { color: colors.secondaryText }]} type="body">
          The requested book status is not valid.
        </ThemedText>
      </View>
    );
  }

  if (statusBooks.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
        <BackNavigationHeader title={config.title} />

        <View style={styles.emptyContainer}>
          <ThemedView
            variant="card"
            style={[
              styles.emptyState,
              {
                borderColor: colors.cardBorder,
              },
            ]}
          >
            <View
              style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}
            >
              <Ionicons name={config.icon as any} size={48} color={colors.tertiaryText} />
            </View>
            <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
              {config.emptyMessage}
            </ThemedText>
            <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
              {config.emptySubtitle}
            </ThemedText>
          </ThemedView>
        </View>
      </View>
    );
  }

  const renderBook = ({ item: book, index }: { item: UserBook; index: number }) => (
    <AnimatedListItem index={index}>
      <Pressable
        onPress={() => router.push(`/book/${book.hiveId}?status=${status}`)}
        style={[
          styles.bookItem,
          {
            backgroundColor: colors.cardBackground,
            borderColor: colors.cardBorder,
            shadowColor: colors.shadowLight,
          },
        ]}
      >
        <View style={styles.coverContainer}>
          <FadeInImage
            source={{
              uri: `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
            }}
            style={styles.bookCover}
            resizeMode="cover"
          />
        </View>
        <View style={styles.bookInfo}>
          <ThemedText
            style={[styles.bookTitle, { color: colors.primaryText }]}
            numberOfLines={2}
            type="label"
          >
            {book.title}
          </ThemedText>
          <ThemedText
            style={[styles.bookAuthor, { color: colors.secondaryText }]}
            numberOfLines={1}
            type="caption"
          >
            {book.authors}
          </ThemedText>
          {book.stars != null && book.stars > 0 && (
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={14} color={colors.primary} />
              <ThemedText
                style={[styles.ratingText, { color: colors.secondaryText }]}
                type="caption"
              >
                {book.stars / 10}
              </ThemedText>
            </View>
          )}
        </View>
      </Pressable>
    </AnimatedListItem>
  );

  const handleSortChange = (newSortBy: SortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(newSortBy);
      setSortOrder(newSortBy === "dateAdded" || newSortBy === "dateRead" ? "desc" : "asc");
    }
  };

  const sortOptions: {
    key: SortBy;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
  }[] = [
    { key: "dateAdded", label: "Date Added", icon: "calendar-outline" },
    { key: "dateRead", label: "Date Read", icon: "book-outline" },
    { key: "title", label: "Title", icon: "text-outline" },
    { key: "author", label: "Author", icon: "person-outline" },
  ];

  return (
    <View style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
      <BackNavigationHeader title={config.title} />

      <View style={styles.sortContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortButtonsContainer}
        >
          {sortOptions.map((option) => {
            const isActive = sortBy === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => handleSortChange(option.key)}
                style={[
                  styles.sortButton,
                  {
                    backgroundColor: isActive ? colors.primary : colors.buttonBackground,
                    borderColor: isActive ? colors.primary : colors.buttonBorder,
                  },
                ]}
              >
                <Ionicons
                  name={option.icon}
                  size={16}
                  color={isActive ? colors.background : colors.primary}
                />
                <ThemedText
                  style={[
                    styles.sortButtonText,
                    {
                      color: isActive ? colors.background : colors.primaryText,
                    },
                  ]}
                  type="label"
                >
                  {option.label}
                </ThemedText>
                {isActive && (
                  <Ionicons
                    name={sortOrder === "asc" ? "arrow-up" : "arrow-down"}
                    size={14}
                    color={colors.background}
                    style={styles.sortOrderIcon}
                  />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {availableGenres.length > 0 && (
        <View style={styles.genreContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortButtonsContainer}
          >
            <Pressable
              onPress={() => setSelectedGenre(null)}
              style={[
                styles.sortButton,
                {
                  backgroundColor: !activeGenre ? colors.primary : colors.buttonBackground,
                  borderColor: !activeGenre ? colors.primary : colors.buttonBorder,
                },
              ]}
            >
              <Ionicons
                name="pricetags-outline"
                size={16}
                color={!activeGenre ? colors.background : colors.primary}
              />
              <ThemedText
                style={[
                  styles.sortButtonText,
                  { color: !activeGenre ? colors.background : colors.primaryText },
                ]}
                type="label"
              >
                All genres
              </ThemedText>
            </Pressable>
            {availableGenres.map(({ genre, count }) => {
              const isActive = activeGenre === genre;
              return (
                <Pressable
                  key={genre}
                  onPress={() => setSelectedGenre(isActive ? null : genre)}
                  style={[
                    styles.sortButton,
                    {
                      backgroundColor: isActive ? colors.primary : colors.buttonBackground,
                      borderColor: isActive ? colors.primary : colors.buttonBorder,
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.sortButtonText,
                      { color: isActive ? colors.background : colors.primaryText },
                    ]}
                    type="label"
                  >
                    {genre}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.genreCount,
                      {
                        color: isActive ? colors.background : colors.secondaryText,
                      },
                    ]}
                    type="caption"
                  >
                    {count}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={styles.header}>
        <ThemedText style={[styles.bookCount, { color: colors.secondaryText }]} type="body">
          {filteredBooks.length} {filteredBooks.length === 1 ? "book" : "books"}
        </ThemedText>
      </View>

      {filteredBooks.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ThemedView
            variant="card"
            style={[styles.emptyState, { borderColor: colors.cardBorder }]}
          >
            <View
              style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}
            >
              <Ionicons name="filter-outline" size={48} color={colors.tertiaryText} />
            </View>
            <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
              No matches
            </ThemedText>
            <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
              No books in {activeGenre ? `"${activeGenre}"` : "this filter"}. Try another genre.
            </ThemedText>
          </ThemedView>
        </View>
      ) : (
        <FlatList
          data={filteredBooks}
          renderItem={renderBook}
          keyExtractor={(item) => item.hiveId}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

export default function FilteredBooks() {
  const { status, did } = useLocalSearchParams<{ status: string; did?: string }>();

  if (!status) {
    return (
      <View style={styles.errorContainer}>
        <ThemedText type="heading">Invalid Status</ThemedText>
      </View>
    );
  }

  return <FilteredBooksContent status={status} did={did} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  loadingText: {
    marginTop: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 16,
  },
  errorTitle: {
    textAlign: "center",
  },
  errorMessage: {
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  emptyState: {
    padding: 32,
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    textAlign: "center",
    marginBottom: 8,
  },
  emptySubtitle: {
    textAlign: "center",
  },
  sortContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  genreContainer: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  genreCount: {
    marginLeft: 4,
    fontSize: 12,
  },
  sortButtonsContainer: {
    gap: 8,
    paddingRight: 16,
  },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  sortOrderIcon: {
    marginLeft: 2,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bookCount: {
    textAlign: "center",
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  bookItem: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    minHeight: 100,
  },
  coverContainer: {
    marginRight: 12,
    justifyContent: "center",
  },
  bookCover: {
    width: 65,
    height: 95,
    borderRadius: 10,
  },
  bookInfo: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 2,
  },
  bookTitle: {
    marginBottom: 4,
    lineHeight: 18,
    fontSize: 15,
  },
  bookAuthor: {
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
});
