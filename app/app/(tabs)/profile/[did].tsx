import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { GradientView } from "@/components/GradientView";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedCard } from "@/components/ThemedCard";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BOOK_STATUS } from "@/constants";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useProfile } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { router } from "expo-router";
import { useCallback, useState } from "react";

export default function ProfileScreen() {
  const { did } = useLocalSearchParams<{ did: string }>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");

  const profile = useProfile(did);
  const [userReviewText, setUserReviewText] = useState("");

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
          Loading profile...
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
        showGoBackButton={true}
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
          Profile Not Found
        </ThemedText>
        <ThemedText
          style={[styles.errorMessage, { color: colors.secondaryText }]}
          type="body"
        >
          Unable to load this profile. Please check the URL and try again.
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
  const readBooks = profile.data.books.filter(
    (book) => book.status === BOOK_STATUS.FINISHED,
  );

  const renderBookItem = ({ item: book }: { item: any }) => (
    <Pressable
      onPress={() => router.push(`/book/${book.hiveId}`)}
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
        {book.stars && (
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
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header Section with Gradient */}
        <GradientView variant="warm" style={styles.headerSection}>
          <View style={styles.headerContent}>
            <View
              style={[
                styles.profileImageContainer,
                { backgroundColor: colors.inactiveBackground },
              ]}
            >
              {profile.data.profile.avatar ? (
                <Image
                  source={{ uri: profile.data.profile.avatar }}
                  style={styles.profileImage}
                />
              ) : (
                <Ionicons name="person" size={40} color={colors.tertiaryText} />
              )}
            </View>
            <View style={styles.headerInfo}>
              <ThemedText
                style={[
                  styles.headerTitle,
                  { color: colorScheme === "dark" ? "#ffffff" : "#1a1a1a" },
                ]}
                type="title"
              >
                {profile.data.profile.displayName || "User"}
              </ThemedText>
              <ThemedText
                style={[
                  styles.headerSubtitle,
                  { color: colorScheme === "dark" ? "#f7fafc" : "#4a5568" },
                ]}
                type="body"
              >
                @{profile.data.profile.handle}
              </ThemedText>
            </View>
          </View>
          <ThemedText
            style={[
              styles.headerBio,
              { color: colorScheme === "dark" ? "#f7fafc" : "#4a5568" },
            ]}
            type="body"
          >
            {profile.data.profile.description || "No bio available"}
          </ThemedText>
        </GradientView>

        {/* Stats Card */}
        <View style={styles.profileSection}>
          <ThemedCard variant="elevated" style={styles.profileCard}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                  type="title"
                >
                  {readBooks.length}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.secondaryText }]}
                  type="caption"
                >
                  Books Read
                </ThemedText>
              </View>
              <View
                style={[
                  styles.statDivider,
                  { backgroundColor: colors.cardBorder },
                ]}
              />
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primary }]}
                  type="title"
                >
                  {profile.data.profile.reviews || 0}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.secondaryText }]}
                  type="caption"
                >
                  Reviews
                </ThemedText>
              </View>
            </View>
          </ThemedCard>
        </View>

        {/* Currently Reading Section */}
        {readingBooks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderContent}>
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: colors.activeBackground },
                  ]}
                >
                  <Ionicons name="book" size={20} color={colors.primary} />
                </View>
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.primaryText }]}
                  type="heading"
                >
                  Currently Reading
                </ThemedText>
              </View>
              <ThemedText
                style={[styles.resultCount, { color: colors.secondaryText }]}
                type="caption"
              >
                {readingBooks.length} books
              </ThemedText>
            </View>
            <FlatList
              data={readingBooks}
              keyExtractor={(item) => item.hiveId}
              renderItem={renderBookItem}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalListContent}
            />
          </View>
        )}

        {/* Want to Read Section */}
        {wantToReadBooks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderContent}>
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: colors.activeBackground },
                  ]}
                >
                  <Ionicons name="bookmark" size={20} color={colors.primary} />
                </View>
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.primaryText }]}
                  type="heading"
                >
                  Want to Read
                </ThemedText>
              </View>
              <ThemedText
                style={[styles.resultCount, { color: colors.secondaryText }]}
                type="caption"
              >
                {wantToReadBooks.length} books
              </ThemedText>
            </View>
            <FlatList
              data={wantToReadBooks}
              keyExtractor={(item) => item.hiveId}
              renderItem={renderBookItem}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalListContent}
            />
          </View>
        )}

        {/* Read Books Section */}
        {readBooks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderContent}>
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: colors.activeBackground },
                  ]}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={colors.primary}
                  />
                </View>
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.primaryText }]}
                  type="heading"
                >
                  Read Books
                </ThemedText>
              </View>
              <ThemedText
                style={[styles.resultCount, { color: colors.secondaryText }]}
                type="caption"
              >
                {readBooks.length} books
              </ThemedText>
            </View>
            <FlatList
              data={readBooks}
              keyExtractor={(item) => item.hiveId}
              renderItem={renderBookItem}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalListContent}
            />
          </View>
        )}

        {/* Empty State */}
        {readingBooks.length === 0 &&
          wantToReadBooks.length === 0 &&
          readBooks.length === 0 && (
            <View style={styles.emptyState}>
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
                style={[styles.emptyTitle, { color: colors.primaryText }]}
                type="heading"
              >
                No Books Yet
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: colors.secondaryText }]}
                type="body"
              >
                This user hasn't added any books to their library yet.
              </ThemedText>
            </View>
          )}

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 100, // Account for tab bar
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
    paddingHorizontal: 40,
  },
  errorTitle: {
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  errorMessage: {
    textAlign: "center",
    lineHeight: 20,
  },
  headerSection: {
    paddingTop: 60,
    paddingBottom: 32,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
  },
  headerInfo: {
    flex: 1,
  },
  headerBio: {
    marginTop: 16,
    lineHeight: 20,
  },
  headerTitle: {
    marginBottom: 8,
  },
  headerSubtitle: {
    lineHeight: 24,
  },
  profileSection: {
    margin: 20,
  },
  profileCard: {
    padding: 24,
  },
  profileImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  profileImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
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
  bookItem: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 16,
    marginRight: 12,
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    width: 280,
  },
  coverContainer: {
    marginRight: 16,
  },
  bookCover: {
    width: 60,
    height: 90,
    borderRadius: 8,
  },
  bookInfo: {
    flex: 1,
    justifyContent: "center",
  },
  bookTitle: {
    marginBottom: 4,
    lineHeight: 18,
  },
  bookAuthor: {
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
  scrollView: {
    flex: 1,
  },
  bottomSpacing: {
    height: 100, // Account for tab bar
  },
});
