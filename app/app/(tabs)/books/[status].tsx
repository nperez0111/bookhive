import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { BookGridItem } from "@/components/BookGridItem";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { BOOK_STATUS, BOOK_STATUS_MAP } from "@/constants";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
  Dimensions,
  Pressable,
  ScrollView,
} from "react-native";
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
    status: BOOK_STATUS.OWNED,
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
        // For finished books, use finishedAt; for reading books, use startedAt
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

    // Handle null values - put them at the end
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;

    // Compare values
    let comparison = 0;
    if (aValue < bValue) comparison = -1;
    if (aValue > bValue) comparison = 1;

    return sortOrder === "asc" ? comparison : -comparison;
  });

  return sorted;
};

function FilteredBooksContent({ status }: { status: string }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const [numColumns, setNumColumns] = useState(2);
  const [sortBy, setSortBy] = useState<SortBy>("dateAdded");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const profile = useProfile();

  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];

  const filteredBooks = useMemo(() => {
    if (!profile.data) return [];
    const filtered = profile.data.books.filter(
      (book) => book.status === config.status,
    );
    return sortBooks(filtered, sortBy, sortOrder, config.status);
  }, [profile.data, config.status, sortBy, sortOrder]);

  // Calculate responsive number of columns
  useEffect(() => {
    const calculateColumns = () => {
      const screenWidth = Dimensions.get("window").width;
      const containerPadding = 32; // 16px padding on each side
      const availableWidth = screenWidth - containerPadding;

      // BookCard width is 180px, so calculate how many can fit
      const bookCardWidth = 180;
      const gap = 16; // Space between items
      const maxColumns = Math.floor(
        (availableWidth + gap) / (bookCardWidth + gap),
      );
      const columns = Math.max(2, Math.min(maxColumns, 4)); // Between 2-4 columns

      setNumColumns(columns);
    };

    calculateColumns();

    const subscription = Dimensions.addEventListener(
      "change",
      calculateColumns,
    );
    return () => subscription?.remove();
  }, []);

  if (profile.isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText
          style={[styles.loadingText, { color: colors.secondaryText }]}
          type="body"
        >
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
        <Ionicons
          name="alert-circle-outline"
          size={64}
          color={colors.primary}
        />
        <ThemedText
          style={[styles.errorTitle, { color: colors.primaryText }]}
          type="heading"
        >
          Invalid Status
        </ThemedText>
        <ThemedText
          style={[styles.errorMessage, { color: colors.secondaryText }]}
          type="body"
        >
          The requested book status is not valid.
        </ThemedText>
      </View>
    );
  }

  if (filteredBooks.length === 0) {
    return (
      <View
        style={[styles.container, { backgroundColor, paddingBottom: bottom }]}
      >
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
              style={[
                styles.emptyIconContainer,
                { backgroundColor: colors.inactiveBackground },
              ]}
            >
              <Ionicons
                name={config.icon as any}
                size={48}
                color={colors.tertiaryText}
              />
            </View>
            <ThemedText
              style={[styles.emptyTitle, { color: colors.primaryText }]}
              type="heading"
            >
              {config.emptyMessage}
            </ThemedText>
            <ThemedText
              style={[styles.emptySubtitle, { color: colors.secondaryText }]}
              type="body"
            >
              {config.emptySubtitle}
            </ThemedText>
          </ThemedView>
        </View>
      </View>
    );
  }

  const renderBook = ({ item, index }: { item: UserBook; index: number }) => (
    <BookGridItem book={item} status={status} numColumns={numColumns} />
  );

  const handleSortChange = (newSortBy: SortBy) => {
    if (sortBy === newSortBy) {
      // Toggle order if clicking the same sort option
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      // Set new sort and default to desc for dates, asc for text
      setSortBy(newSortBy);
      setSortOrder(
        newSortBy === "dateAdded" || newSortBy === "dateRead" ? "desc" : "asc",
      );
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
    <View
      style={[styles.container, { backgroundColor, paddingBottom: bottom }]}
    >
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
                    backgroundColor: isActive
                      ? colors.primary
                      : colors.buttonBackground,
                    borderColor: isActive
                      ? colors.primary
                      : colors.buttonBorder,
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

      <View style={styles.header}>
        <ThemedText
          style={[styles.bookCount, { color: colors.secondaryText }]}
          type="body"
        >
          {filteredBooks.length} {filteredBooks.length === 1 ? "book" : "books"}
        </ThemedText>
      </View>

      <FlatList
        data={filteredBooks}
        renderItem={renderBook}
        keyExtractor={(item) => item.hiveId}
        numColumns={numColumns}
        contentContainerStyle={styles.gridContainer}
        columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

export default function FilteredBooks() {
  const { status } = useLocalSearchParams<{ status: string }>();

  if (!status) {
    return (
      <View style={styles.errorContainer}>
        <ThemedText type="heading">Invalid Status</ThemedText>
      </View>
    );
  }

  return <FilteredBooksContent status={status} />;
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
  gridContainer: {
    padding: 16,
  },
  row: {
    justifyContent: "space-between",
    marginBottom: 16,
  },
});
