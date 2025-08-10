import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  RefreshControl,
  ScrollView,
  ImageBackground,
} from "react-native";

import { HelloWave } from "@/components/HelloWave";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GradientView } from "@/components/GradientView";
import { getBaseUrl } from "@/context/auth";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { router } from "expo-router";
import { useState, useCallback } from "react";
import { BOOK_STATUS } from "@/constants";
import { UserBook } from "../../../src/bsky/lexicon/types/buzz/bookhive/defs";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { FadeInImage } from "@/components/FadeInImage";
import { SectionHeader } from "@/components/SectionHeader";
import { StatsCard } from "@/components/StatsCard";
import { BookCard } from "@/components/BookCard";
import { QuickAction } from "@/components/QuickAction";

interface BookSectionProps {
  books: UserBook[];
  title: string;
  icon: string;
  emptyMessage: string;
  emptySubtitle: string;
  colorScheme: string;
  colors: any;
}

function BookSection({
  books,
  title,
  icon,
  emptyMessage,
  emptySubtitle,
  colors,
}: BookSectionProps) {
  if (books.length === 0) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderContent}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: colors.activeBackground },
              ]}
            >
              <Ionicons name={icon as any} size={20} color={colors.primary} />
            </View>
            <ThemedText
              style={[styles.sectionTitle, { color: colors.primaryText }]}
              type="heading"
            >
              {title}
            </ThemedText>
          </View>
        </View>

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
              name="book-outline"
              size={32}
              color={colors.tertiaryText}
            />
          </View>
          <ThemedText
            style={[styles.emptyTitle, { color: colors.primaryText }]}
            type="heading"
          >
            {emptyMessage}
          </ThemedText>
          <ThemedText
            style={[styles.emptySubtitle, { color: colors.secondaryText }]}
            type="body"
          >
            {emptySubtitle}
          </ThemedText>
        </ThemedView>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader
        icon={icon as any}
        title={title}
        right={
          <ThemedText
            style={[styles.bookCount, { color: colors.secondaryText }]}
            type="caption"
            numberOfLines={1}
          >
            {books.length} {books.length === 1 ? "book" : "books"}
          </ThemedText>
        }
        style={{ marginBottom: 16 }}
      />

      <FlatList
        data={books}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalListContent}
        keyExtractor={(item) => item.hiveId}
        renderItem={({ item: book, index }) => (
          <AnimatedListItem index={index}>
            <BookCard
              title={book.title}
              authors={book.authors}
              imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`}
              onPress={() => router.push(`/book/${book.hiveId}`)}
              orientation="horizontal"
              style={{
                width: 180,
                marginRight: 16,
                paddingBottom: 8,
                alignItems: "center",
              }}
            />
          </AnimatedListItem>
        )}
      />
    </View>
  );
}

export default function HomeScreen() {
  const profile = useProfile();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    profile.refetch().finally(() => setIsRefreshing(false));
  }, [profile.refetch]);

  if (profile.isLoading && !isRefreshing && !profile.data) {
    return (
      <ThemedView style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText
          style={[styles.loadingText, { color: colors.secondaryText }]}
          type="body"
        >
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
        <Ionicons
          name="alert-circle-outline"
          size={64}
          color={colors.primary}
        />
        <ThemedText
          style={[styles.errorTitle, { color: colors.primaryText }]}
          type="heading"
        >
          No Profile Data
        </ThemedText>
        <ThemedText
          style={[styles.errorMessage, { color: colors.secondaryText }]}
          type="body"
        >
          Unable to load your profile. Please try refreshing.
        </ThemedText>
      </ThemedView>
    );
  }

  const readingBooks = profile.data.books.filter(
    (book) => book.status === BOOK_STATUS.READING,
  );
  const wantToReadBooks = profile.data.books.filter(
    (book) => book.status === BOOK_STATUS.WANTTOREAD,
  );
  const finishedBooks = profile.data.books.filter(
    (book) => book.status === BOOK_STATUS.FINISHED,
  );

  const totalBooks = profile.data.books.length;
  const friendActivity = profile.data.friendActivity ?? [];

  return (
    <ThemedView
      style={[styles.container, { backgroundColor, paddingBottom: bottom }]}
    >
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
        {/* Welcome Header with Gradient */}
        <GradientView variant="warm" style={styles.welcomeSection}>
          <View style={styles.welcomeContent}>
            <View style={styles.welcomeTextContainer}>
              <ThemedText
                style={[
                  styles.welcomeOverline,
                  { color: colorScheme === "dark" ? "#ffffff" : "#1a1a1a" },
                ]}
                type="overline"
              >
                Welcome back
              </ThemedText>
              <ThemedText
                style={[
                  styles.welcomeName,
                  { color: colorScheme === "dark" ? "#ffffff" : "#1a1a1a" },
                ]}
                type="title"
              >
                {profile.data.profile.displayName ||
                  profile.data.profile.handle}
              </ThemedText>
              <View style={styles.quickActionsRow}>
                <QuickAction
                  icon="search"
                  label="Search"
                  onPress={() => router.push("/search")}
                />
              </View>
            </View>
            <HelloWave />
          </View>
        </GradientView>

        {/* Stats Section */}
        <StatsCard
          style={styles.statsSection}
          items={[
            { label: "Total Books", value: totalBooks },
            { label: "Currently Reading", value: readingBooks.length },
            { label: "Finished", value: finishedBooks.length },
          ]}
        />

        {/* Book Sections */}
        <BookSection
          books={readingBooks}
          title="Currently Reading"
          icon="book"
          emptyMessage="No books in progress"
          emptySubtitle="Start reading a book to see it here"
          colorScheme={colorScheme ?? "light"}
          colors={colors}
        />

        <BookSection
          books={wantToReadBooks}
          title="Want to Read"
          icon="bookmark"
          emptyMessage="No books in your list"
          emptySubtitle="Add books to your reading list"
          colorScheme={colorScheme ?? "light"}
          colors={colors}
        />

        <BookSection
          books={finishedBooks}
          title="Finished"
          icon="checkmark-circle"
          emptyMessage="No finished books"
          emptySubtitle="Complete a book to see it here"
          colorScheme={colorScheme ?? "light"}
          colors={colors}
        />

        {/* Friend Activity */}
        <View style={styles.section}>
          <SectionHeader
            icon={"people" as any}
            title="Friend Activity"
            right={
              <ThemedText
                style={[styles.bookCount, { color: colors.secondaryText }]}
                type="caption"
                numberOfLines={1}
              >
                {friendActivity.length}{" "}
                {friendActivity.length === 1 ? "item" : "items"}
              </ThemedText>
            }
            style={{ marginBottom: 16 }}
          />

          {friendActivity.length === 0 ? (
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
                  name="people-outline"
                  size={32}
                  color={colors.tertiaryText}
                />
              </View>
              <ThemedText
                style={[styles.emptyTitle, { color: colors.primaryText }]}
                type="heading"
              >
                No friend activity yet
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: colors.secondaryText }]}
                type="body"
              >
                Follow some friends to see their book activity here
              </ThemedText>
            </ThemedView>
          ) : (
            <FlatList
              data={friendActivity}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalListContent}
              keyExtractor={(item) =>
                item.hiveId +
                "_" +
                item.userDid +
                "_" +
                (item.startedAt || item.finishedAt || item.createdAt)
              }
              renderItem={({ item: book, index }) => (
                <AnimatedListItem index={index}>
                  <BookCard
                    title={book.title}
                    authors={book.authors}
                    meta={`@${book.userHandle ?? book.userDid}`}
                    imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`}
                    onPress={() => router.push(`/book/${book.hiveId}`)}
                    orientation="horizontal"
                    style={{
                      width: 180,
                      marginRight: 16,
                      paddingBottom: 8,
                      alignItems: "center",
                    }}
                  />
                </AnimatedListItem>
              )}
            />
          )}
        </View>

        <View style={[styles.bottomSpacing, { height: 20 + bottom }]} />
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
    paddingBottom: 32,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  welcomeContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  welcomeOverline: {
    opacity: 0.9,
  },
  welcomeTextContainer: {
    flex: 1,
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  welcomeTitle: {
    marginBottom: 4,
  },
  welcomeName: {
    lineHeight: 40,
  },
  statsSection: {
    margin: 20,
    padding: 24,
    borderRadius: 20,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    marginBottom: 4,
  },
  statLabel: {
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    height: 40,
    marginHorizontal: 10,
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
  horizontalListContent: {
    paddingHorizontal: 20,
  },
  bookCard: {
    borderRadius: 20,
    padding: 16,
    marginRight: 16,
    width: 140,
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  coverContainer: {
    marginBottom: 12,
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  bookCover: {
    width: 100,
    height: 150,
    borderRadius: 12,
  },
  bookInfo: {
    flex: 1,
  },
  bookTitle: {
    marginBottom: 4,
    lineHeight: 18,
  },
  bookAuthor: {
    lineHeight: 16,
  },
  bottomSpacing: {
    height: 20,
  },
});
