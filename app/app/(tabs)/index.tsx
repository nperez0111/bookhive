import {
  ActivityIndicator,
  FlatList,
  Image,
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
  colorScheme,
  colors,
}: BookSectionProps) {
  const backgroundColor = useThemeColor({}, "background");

  if (books.length === 0) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderContent}>
            <Ionicons
              name={icon as any}
              size={24}
              color={colorScheme === "dark" ? "#FBBF24" : "#FBBF24"}
            />
            <ThemedText
              style={[
                styles.sectionTitle,
                { color: colorScheme === "dark" ? "white" : colors.text },
              ]}
            >
              {title}
            </ThemedText>
          </View>
        </View>

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
            name="book-outline"
            size={48}
            color={colorScheme === "dark" ? "#9CA3AF" : "#6B7280"}
          />
          <ThemedText
            style={[
              styles.emptyTitle,
              { color: colorScheme === "dark" ? "white" : colors.text },
            ]}
          >
            {emptyMessage}
          </ThemedText>
          <ThemedText
            style={[
              styles.emptySubtitle,
              { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
            ]}
          >
            {emptySubtitle}
          </ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderContent}>
          <Ionicons
            name={icon as any}
            size={24}
            color={colorScheme === "dark" ? "#FBBF24" : "#FBBF24"}
          />
          <ThemedText
            style={[
              styles.sectionTitle,
              { color: colorScheme === "dark" ? "white" : colors.text },
            ]}
          >
            {title}
          </ThemedText>
        </View>
        <ThemedText
          style={[
            styles.bookCount,
            { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
          ]}
        >
          {books.length} {books.length === 1 ? "book" : "books"}
        </ThemedText>
      </View>

      <FlatList
        data={books}
        renderItem={({ item: book }) => (
          <Pressable
            onPress={() => router.push(`/book/${book.hiveId}`)}
            style={[
              styles.bookCard,
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
                style={styles.bookCover}
                resizeMode="cover"
              />
            </View>
            <View style={styles.bookInfo}>
              <ThemedText
                style={[
                  styles.bookTitle,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
                numberOfLines={2}
              >
                {book.title}
              </ThemedText>
              <ThemedText
                style={[
                  styles.bookAuthor,
                  { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
                ]}
                numberOfLines={1}
              >
                {book.authors}
              </ThemedText>
            </View>
          </Pressable>
        )}
        keyExtractor={(item) => item.hiveId}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalListContent}
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

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    profile.refetch().finally(() => setIsRefreshing(false));
  }, [profile.refetch]);

  if (profile.isLoading && !isRefreshing && !profile.data) {
    return (
      <ThemedView style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color="#FBBF24" />
        <ThemedText
          style={[
            styles.loadingText,
            { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
          ]}
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
        <Ionicons name="alert-circle-outline" size={64} color="#FBBF24" />
        <ThemedText
          style={[
            styles.errorTitle,
            { color: colorScheme === "dark" ? "white" : colors.text },
          ]}
        >
          No Profile Data
        </ThemedText>
        <ThemedText
          style={[
            styles.errorMessage,
            { color: colorScheme === "dark" ? "#9CA3AF" : "#6B7280" },
          ]}
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

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#FBBF24"
            colors={["#FBBF24"]}
          />
        }
      >
        {/* Welcome Header */}
        <View style={styles.welcomeSection}>
          <View style={styles.welcomeContent}>
            <View style={styles.welcomeTextContainer}>
              <ThemedText
                style={[
                  styles.welcomeTitle,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                Welcome back,
              </ThemedText>
              <ThemedText
                style={[
                  styles.welcomeName,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
              >
                {profile.data.profile.displayName}!
              </ThemedText>
            </View>
            <HelloWave />
          </View>

          {totalBooks > 0 && (
            <View
              style={[
                styles.statsContainer,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                >
                  {totalBooks}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.tertiaryText }]}
                >
                  Total Books
                </ThemedText>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                >
                  {readingBooks.length}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.tertiaryText }]}
                >
                  Reading
                </ThemedText>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                >
                  {finishedBooks.length}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.tertiaryText }]}
                >
                  Completed
                </ThemedText>
              </View>
            </View>
          )}
        </View>

        {/* Book Sections */}
        <BookSection
          books={readingBooks}
          title="Currently Reading"
          icon="bookmark"
          emptyMessage="No books in progress"
          emptySubtitle="Start reading a book to see it here"
          colorScheme={colorScheme ?? "light"}
          colors={colors}
        />

        <BookSection
          books={wantToReadBooks}
          title="Want to Read"
          icon="heart"
          emptyMessage="No books in your wishlist"
          emptySubtitle="Add books you want to read"
          colorScheme={colorScheme ?? "light"}
          colors={colors}
        />

        <BookSection
          books={finishedBooks}
          title="Completed"
          icon="checkmark-circle"
          emptyMessage="No completed books"
          emptySubtitle="Finish reading books to see them here"
          colorScheme={colorScheme ?? "light"}
          colors={colors}
        />

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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  welcomeSection: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 24,
  },
  welcomeContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  welcomeTextContainer: {
    flex: 1,
  },
  welcomeTitle: {
    fontSize: 18,
    marginBottom: 4,
  },
  welcomeName: {
    fontSize: 28,
    fontWeight: "bold",
    lineHeight: 36,
  },
  statsContainer: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
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
  bookCount: {
    fontSize: 14,
  },
  emptyState: {
    marginHorizontal: 20,
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
  horizontalListContent: {
    paddingHorizontal: 20,
  },
  bookCard: {
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
  bookCover: {
    width: 100,
    height: 150,
    borderRadius: 8,
  },
  bookInfo: {
    flex: 1,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
    lineHeight: 18,
  },
  bookAuthor: {
    fontSize: 12,
    lineHeight: 16,
  },
  bottomSpacing: {
    height: 20,
  },
});
