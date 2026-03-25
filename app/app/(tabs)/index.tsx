import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { AnimatedListItem } from "@/components/AnimatedListItem";
import { BookCard } from "@/components/BookCard";
import { CreateListModal } from "@/components/CreateListModal";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { QuickAction } from "@/components/QuickAction";
import { SectionHeader } from "@/components/SectionHeader";
import { StatsCard } from "@/components/StatsCard";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { BOOK_STATUS } from "@/constants";
import { Colors } from "@/constants/Colors";
import { getBaseUrl, useAuth } from "@/context/auth";
import { useProfile, useUserLists } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { Ionicons } from "@expo/vector-icons";
import { isThisMonth, isThisYear } from "date-fns";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { UserBook } from "../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

const MAX_BOOKS_PER_SECTION = 20;

function BookGrid({ books, colors }: { books: UserBook[]; colors: any }) {
  return (
    <View style={styles.gridContainer}>
      {books.map((book, index) => (
        <View key={book.hiveId} style={styles.gridItem}>
          <AnimatedListItem index={index}>
            <BookCard
              title={book.title}
              authors={book.authors}
              imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`}
              onPress={() => router.push(`/book/${book.hiveId}`)}
              variant="dense"
            />
          </AnimatedListItem>
        </View>
      ))}
    </View>
  );
}

interface BookSectionProps {
  books: UserBook[];
  title: string;
  icon: string;
  emptyMessage: string;
  emptySubtitle: string;
  colors: any;
  status: string;
}

function BookSection({
  books,
  title,
  icon,
  emptyMessage,
  emptySubtitle,
  colors,
  status,
}: BookSectionProps) {
  const displayBooks = books.slice(0, MAX_BOOKS_PER_SECTION);

  if (books.length === 0) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderContent}>
            <View style={[styles.iconContainer, { backgroundColor: colors.activeBackground }]}>
              <Ionicons name={icon as any} size={20} color={colors.primary} />
            </View>
            <ThemedText style={[styles.sectionTitle, { color: colors.primaryText }]} type="heading">
              {title}
            </ThemedText>
          </View>
        </View>

        <ThemedView variant="card" style={[styles.emptyState, { borderColor: colors.cardBorder }]}>
          <View style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}>
            <Ionicons name="book-outline" size={32} color={colors.tertiaryText} />
          </View>
          <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
            {emptyMessage}
          </ThemedText>
          <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
            {emptySubtitle}
          </ThemedText>
        </ThemedView>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => {
          const statusMap: Record<string, string> = {
            [BOOK_STATUS.READING]: "reading",
            [BOOK_STATUS.WANTTOREAD]: "wantToRead",
            [BOOK_STATUS.FINISHED]: "finished",
            [BOOK_STATUS.ABANDONED]: "abandoned",
            owned: "owned",
          };
          router.push(`/books/${statusMap[status] ?? status}` as any);
        }}
      >
        <SectionHeader
          icon={icon as any}
          title={title}
          right={
            <View style={styles.headerRight}>
              <ThemedText
                style={[styles.bookCount, { color: colors.secondaryText }]}
                type="caption"
                numberOfLines={1}
              >
                {books.length} {books.length === 1 ? "book" : "books"}
              </ThemedText>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.secondaryText}
                style={styles.chevron}
              />
            </View>
          }
          style={{ marginBottom: 16 }}
        />
      </Pressable>

      <View style={styles.gridPadding}>
        <BookGrid books={displayBooks} colors={colors} />
      </View>
    </View>
  );
}

interface ShelfItem {
  uri: string;
  name: string;
  description?: string;
  itemCount?: number;
}

function ShelvesSection({
  shelves,
  colors,
  onCreatePress,
}: {
  shelves: ShelfItem[];
  colors: any;
  onCreatePress: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        icon="albums"
        title="Your Shelves"
        right={
          <View style={styles.headerRight}>
            <Pressable onPress={onCreatePress} hitSlop={8} style={styles.shelfHeaderAction}>
              <Ionicons name="add" size={18} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => router.push("/lists" as any)}
              hitSlop={8}
              style={styles.shelfHeaderAction}
            >
              <ThemedText style={[styles.seeAll, { color: colors.primary }]} type="caption">
                See all
              </ThemedText>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </Pressable>
          </View>
        }
        style={{ marginBottom: 16 }}
      />

      {shelves.length === 0 ? (
        <Pressable
          onPress={onCreatePress}
          style={[
            styles.emptyState,
            {
              borderColor: colors.cardBorder,
              marginHorizontal: 20,
              borderRadius: 20,
              padding: 32,
              alignItems: "center",
              borderWidth: 1,
              borderStyle: "dashed",
            },
          ]}
        >
          <View style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}>
            <Ionicons name="albums-outline" size={32} color={colors.tertiaryText} />
          </View>
          <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
            No shelves yet
          </ThemedText>
          <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
            Create a shelf to curate your books
          </ThemedText>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shelvesScroll}
        >
          {shelves.map((shelf) => (
            <Pressable
              key={shelf.uri}
              style={[
                styles.shelfCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
              ]}
              onPress={() => router.push(`/lists/${encodeURIComponent(shelf.uri)}` as any)}
            >
              <View style={[styles.shelfIconBadge, { backgroundColor: colors.activeBackground }]}>
                <Ionicons name="albums" size={18} color={colors.primary} />
              </View>
              <ThemedText
                style={[styles.shelfCardName, { color: colors.primaryText }]}
                type="label"
                numberOfLines={2}
              >
                {shelf.name}
              </ThemedText>
              <ThemedText style={{ color: colors.tertiaryText }} type="caption">
                {shelf.itemCount ?? 0} {(shelf.itemCount ?? 0) === 1 ? "book" : "books"}
              </ThemedText>
            </Pressable>
          ))}

          <Pressable
            style={[styles.shelfCard, styles.shelfCardNew, { borderColor: colors.cardBorder }]}
            onPress={onCreatePress}
          >
            <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
            <ThemedText style={[styles.shelfCardName, { color: colors.primary }]} type="label">
              New Shelf
            </ThemedText>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const profile = useProfile();
  const { authState } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createShelfVisible, setCreateShelfVisible] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();

  const listsQuery = useUserLists(authState?.did);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    Promise.all([profile.refetch(), listsQuery.refetch()]).finally(() => setIsRefreshing(false));
  }, [profile.refetch, listsQuery.refetch]);

  const stats = useMemo(() => {
    if (!profile.data) return { totalRead: 0, thisMonth: 0, thisYear: 0 };
    const finishedBooks = profile.data.books.filter((book) => book.status === BOOK_STATUS.FINISHED);
    const totalRead = finishedBooks.length;
    const thisMonth = finishedBooks.filter(
      (book) => book.finishedAt && isThisMonth(new Date(book.finishedAt)),
    ).length;
    const thisYear = finishedBooks.filter(
      (book) => book.finishedAt && isThisYear(new Date(book.finishedAt)),
    ).length;
    return { totalRead, thisMonth, thisYear };
  }, [profile.data]);

  const handleStatPress = useCallback((label: string) => {
    if (label === "Total Read") {
      router.push("/books/finished" as any);
    } else if (label === "This Month" || label === "This Year") {
      router.push("/books/finished" as any);
    }
  }, []);

  if (profile.isLoading && !isRefreshing && !profile.data) {
    return (
      <ThemedView style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText style={[styles.loadingText, { color: colors.secondaryText }]} type="body">
          Loading your library...
        </ThemedText>
      </ThemedView>
    );
  }

  if (profile.error) {
    return (
      <QueryErrorHandler
        error={profile.error}
        onRetry={() => profile.refetch()}
        showRetryButton={true}
        showGoBackButton={false}
      />
    );
  }

  if (!profile.data) {
    return (
      <ThemedView style={[styles.errorContainer, { backgroundColor }]}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.primary} />
        <ThemedText style={[styles.errorTitle, { color: colors.primaryText }]} type="heading">
          No Profile Data
        </ThemedText>
        <ThemedText style={[styles.errorMessage, { color: colors.secondaryText }]} type="body">
          Unable to load your profile. Please try refreshing.
        </ThemedText>
      </ThemedView>
    );
  }

  const readingBooks = profile.data.books.filter((book) => book.status === BOOK_STATUS.READING);
  const wantToReadBooks = profile.data.books.filter(
    (book) => book.status === BOOK_STATUS.WANTTOREAD,
  );
  const ownedBooks = profile.data.books.filter((book: any) => book.owned);

  return (
    <ThemedView style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Welcome Header */}
        <View style={styles.welcomeSection}>
          <ThemedText
            style={[styles.welcomeOverline, { color: colors.secondaryText }]}
            type="caption"
          >
            Welcome back
          </ThemedText>
          <ThemedText style={[styles.welcomeName, { color: colors.primaryText }]} type="title">
            {profile.data.profile.displayName || profile.data.profile.handle}
          </ThemedText>
          <View style={styles.quickActionsRow}>
            <QuickAction icon="search" label="Search" onPress={() => router.push("/search")} />
            <QuickAction
              icon="compass"
              label="Explore"
              onPress={() => router.push("/explore" as any)}
            />
          </View>
        </View>

        {/* Stats Section */}
        <StatsCard
          style={styles.statsSection}
          items={[
            { label: "Total Read", value: stats.totalRead },
            { label: "This Month", value: stats.thisMonth },
            { label: "This Year", value: stats.thisYear },
          ]}
          onItemPress={handleStatPress}
        />

        {/* Book Sections */}
        <BookSection
          books={readingBooks}
          title="Currently Reading"
          icon="book"
          emptyMessage="No books in progress"
          emptySubtitle="Start reading a book to see it here"
          colors={colors}
          status={BOOK_STATUS.READING}
        />

        <BookSection
          books={wantToReadBooks}
          title="Want to Read"
          icon="bookmark"
          emptyMessage="No books in your list"
          emptySubtitle="Add books to your reading list"
          colors={colors}
          status={BOOK_STATUS.WANTTOREAD}
        />

        {ownedBooks.length > 0 && (
          <BookSection
            books={ownedBooks}
            title="Owned"
            icon="library"
            emptyMessage="No owned books"
            emptySubtitle="Books you own will appear here"
            colors={colors}
            status="owned"
          />
        )}

        <ShelvesSection
          shelves={listsQuery.data?.lists ?? []}
          colors={colors}
          onCreatePress={() => setCreateShelfVisible(true)}
        />

        <View style={[styles.bottomSpacing, { height: 20 + bottom }]} />
      </ScrollView>

      <CreateListModal visible={createShelfVisible} onClose={() => setCreateShelfVisible(false)} />
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  errorTitle: {
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  errorMessage: {
    textAlign: "center",
    lineHeight: 24,
  },
  welcomeSection: {
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  welcomeOverline: {
    marginBottom: 4,
  },
  welcomeName: {
    lineHeight: 40,
    marginBottom: 12,
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statsSection: {
    margin: 20,
    marginTop: 0,
    padding: 24,
    borderRadius: 20,
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
  bookCount: {
    textAlign: "right",
    flexShrink: 0,
  },
  emptyState: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
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
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gridItem: {
    width: "47%",
  },
  gridPadding: {
    paddingHorizontal: 20,
  },
  bottomSpacing: {
    height: 20,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chevron: {
    marginLeft: 4,
  },
  shelfHeaderAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAll: {
    fontWeight: "500",
  },
  shelvesScroll: {
    paddingHorizontal: 20,
    gap: 12,
  },
  shelfCard: {
    width: 140,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  shelfCardNew: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderStyle: "dashed",
  },
  shelfIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  shelfCardName: {
    fontWeight: "600",
  },
});
