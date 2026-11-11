import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { MotionPressable } from "@/components/motion/MotionPressable";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BOOK_STATUS } from "@/constants";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useFollow, useUnfollow, useProfile, useUserLists } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useCallback, useState } from "react";
import { ListItem } from "@/components/ListItem";
import { ProfileBookSection } from "./ProfileBookSection";
import { StarDisplay } from "@/components/StarDisplay";
import { ThemedButton } from "@/components/ThemedButton";
import { parseHtmlToText } from "@/utils/htmlToText";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function FollowButton({ targetDid, isFollowing }: { targetDid: string; isFollowing: boolean }) {
  const follow = useFollow();
  const unfollow = useUnfollow();
  const colors = Colors[useColorScheme() ?? "light"];
  const pending = follow.isPending || unfollow.isPending;
  const onPress = () => {
    if (pending) return;
    const mutation = isFollowing ? unfollow : follow;
    mutation.mutate(
      { did: targetDid },
      {
        onError: (error) => Alert.alert("Unable to update follow", error.message),
      },
    );
  };
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={isFollowing ? "Unfollow reader" : "Follow reader"}
      disabled={pending}
      accessibilityState={{ disabled: pending, busy: pending }}
      onPress={onPress}
      style={{
        backgroundColor: isFollowing ? colors.inactiveBackground : colors.primary,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 44,
        borderRadius: 9999,
        opacity: pending ? 0.7 : 1,
      }}
    >
      {pending ? (
        <ActivityIndicator
          size="small"
          color={isFollowing ? colors.primaryText : Colors.light.primaryText}
        />
      ) : (
        <ThemedText
          type="caption"
          style={{ color: isFollowing ? colors.primaryText : Colors.light.primaryText }}
        >
          {isFollowing ? "Unfollow" : "Follow"}
        </ThemedText>
      )}
    </MotionPressable>
  );
}

export default function ReaderProfileScreen({
  did,
  inProfileTab = false,
}: {
  did: string;
  inProfileTab?: boolean;
}) {
  const { authState } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);
  const [shelvesExpanded, setShelvesExpanded] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const tabOverflow = useBottomTabOverflow();
  const { bottom = 0 } = useSafeAreaInsets();

  const profile = useProfile(did);
  const listsQuery = useUserLists(did);
  const userLists = listsQuery.data?.lists ?? [];
  const refetchProfile = profile.refetch;
  const refetchLists = listsQuery.refetch;

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all([refetchProfile(), refetchLists()]).finally(() => setIsRefreshing(false));
  }, [refetchProfile, refetchLists]);

  if (profile.isLoading && !isRefreshing && !profile.data) {
    return (
      <ThemedView style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <ThemedText style={[styles.loadingText, { color: colors.secondaryText }]} type="body">
          Loading profile...
        </ThemedText>
      </ThemedView>
    );
  }

  if (profile.error && !profile.data) {
    return (
      <QueryErrorHandler
        error={profile.error}
        onRetry={() => profile.refetch()}
        showRetryButton={true}
        showGoBackButton={!inProfileTab}
      />
    );
  }

  if (!profile.data) {
    return (
      <ThemedView style={[styles.errorContainer, { backgroundColor }]}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.primary} />
        <ThemedText style={[styles.errorTitle, { color: colors.primaryText }]} type="heading">
          Profile Not Found
        </ThemedText>
        <ThemedText style={[styles.errorMessage, { color: colors.secondaryText }]} type="body">
          Unable to load this profile. Please check the URL and try again.
        </ThemedText>
      </ThemedView>
    );
  }

  // Dedupe by hiveId to avoid duplicate keys in FlatLists
  const dedupeByHiveId = <T extends { hiveId: string }>(books: T[]) => {
    const seen = new Set<string>();
    const unique: T[] = [];
    for (const book of books) {
      const key = String(book.hiveId);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(book);
      }
    }
    return unique;
  };

  const readingBooks = dedupeByHiveId(
    profile.data.books.filter((book) => book.status === BOOK_STATUS.READING),
  );
  const wantToReadBooks = dedupeByHiveId(
    profile.data.books.filter((book) => book.status === BOOK_STATUS.WANTTOREAD),
  );
  const readBooks = dedupeByHiveId(
    profile.data.books.filter((book) => book.status === BOOK_STATUS.FINISHED),
  );
  const reviews = dedupeByHiveId(profile.data.books.filter((book) => book.review?.trim()));
  const bio = profile.data.profile.description?.trim();
  const bioPreview = bio?.split(/\n\s*\n/)[0];
  const canExpandBio =
    !!bio && (bio !== bioPreview || bio.length > 120 || bio.split("\n").length > 3);

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingBottom: 32 + tabOverflow + bottom },
        ]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {profile.error && (
          <ThemedText accessibilityRole="alert" style={{ padding: 20, color: colors.error }}>
            Could not refresh this profile. Pull down to try again.
          </ThemedText>
        )}
        <View style={styles.headerSection}>
          <View style={styles.headerContent}>
            <View
              style={[
                styles.profileImageContainer,
                { backgroundColor: colors.inactiveBackground, borderColor: colors.primary },
              ]}
            >
              {profile.data.profile.avatar ? (
                <Image source={{ uri: profile.data.profile.avatar }} style={styles.profileImage} />
              ) : (
                <Ionicons name="person" size={28} color={colors.tertiaryText} />
              )}
            </View>
            <View style={styles.headerInfo}>
              <View>
                <ThemedText
                  style={[styles.headerTitle, { color: colors.primaryText }]}
                  type="heading"
                >
                  {profile.data.profile.displayName || "User"}
                </ThemedText>
              </View>
              <ThemedText
                style={[styles.headerSubtitle, { color: colors.secondaryText }]}
                type="caption"
              >
                @{profile.data.profile.handle}
              </ThemedText>
            </View>
            {did !== authState?.did && typeof profile.data.profile.isFollowing === "boolean" && (
              <FollowButton targetDid={did} isFollowing={profile.data.profile.isFollowing} />
            )}
          </View>
          {bio ? (
            <View style={{ marginTop: 12 }}>
              <ThemedText
                numberOfLines={!bioExpanded && canExpandBio ? 3 : undefined}
                style={[styles.headerBio, { color: colors.secondaryText }]}
                type="body"
              >
                {bioExpanded ? bio : bioPreview}
              </ThemedText>
              {canExpandBio && (
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel={bioExpanded ? "Show less bio" : "Show full bio"}
                  accessibilityState={{ expanded: bioExpanded }}
                  onPress={() => setBioExpanded((expanded) => !expanded)}
                  style={styles.textAction}
                >
                  <ThemedText type="caption" style={{ color: colors.primary }}>
                    {bioExpanded ? "Show less" : "About this reader"}
                  </ThemedText>
                </MotionPressable>
              )}
            </View>
          ) : null}
        </View>

        {/* Stats Card */}
        <View style={styles.profileSection}>
          <View style={[styles.profileCard, { borderColor: colors.cardBorder }]}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primaryText }]}
                  type="heading"
                >
                  {readBooks.length}
                </ThemedText>
                <ThemedText
                  style={[styles.statLabel, { color: colors.secondaryText }]}
                  type="caption"
                >
                  Read
                </ThemedText>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.statItem}>
                <ThemedText
                  style={[styles.statNumber, { color: colors.primaryText }]}
                  type="heading"
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
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel="View reading stats"
                onPress={() => router.push(`/profile/${did}/stats` as any)}
                style={styles.statsButton}
              >
                <Ionicons name="stats-chart-outline" size={20} color={colors.primary} />
                <ThemedText type="caption" style={{ color: colors.primary }}>
                  Stats
                </ThemedText>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </MotionPressable>
            </View>
          </View>
        </View>

        {/* User Lists */}
        {listsQuery.isLoading && !listsQuery.data && (
          <ThemedText accessibilityLiveRegion="polite">Loading public shelves…</ThemedText>
        )}
        {listsQuery.error && (
          <View style={{ gap: 8 }}>
            <ThemedText accessibilityRole="alert" style={{ color: colors.errorText }}>
              Could not load public shelves.
            </ThemedText>
            <ThemedButton
              title="Retry public shelves"
              variant="outline"
              onPress={() => void refetchLists()}
              disabled={listsQuery.isFetching}
            />
          </View>
        )}
        {userLists.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderContent}>
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.primaryText }]}
                  type="heading"
                >
                  Public shelves
                </ThemedText>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              {userLists.slice(0, shelvesExpanded ? undefined : 3).map((list) => (
                <ListItem
                  key={list.uri}
                  icon="list"
                  title={list.name}
                  subtitle={`${list.itemCount ?? 0} books`}
                  onPress={() => router.push(`/lists/${encodeURIComponent(list.uri)}` as any)}
                />
              ))}
              {userLists.length > 3 && (
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: shelvesExpanded }}
                  onPress={() => setShelvesExpanded((value) => !value)}
                  style={styles.textAction}
                >
                  <ThemedText type="caption" style={{ color: colors.primary }}>
                    {shelvesExpanded ? "Fewer shelves" : `All ${userLists.length} shelves`}
                  </ThemedText>
                </MotionPressable>
              )}
            </View>
          </View>
        )}

        <ProfileBookSection
          books={readingBooks}
          title="Currently reading"
          accessibilityLabel="View currently reading books"
          status="reading"
          did={did}
        />
        <ProfileBookSection
          books={wantToReadBooks}
          title="Want to read"
          accessibilityLabel="View want to read books"
          status="wantToRead"
          did={did}
        />
        <ProfileBookSection
          books={readBooks}
          title="Finished"
          accessibilityLabel="View finished books"
          status="finished"
          did={did}
        />

        {reviews.length > 0 && (
          <View style={styles.section}>
            <ThemedText type="heading" style={{ marginBottom: 12 }}>
              Reviews
            </ThemedText>
            <View style={{ gap: 12 }}>
              {reviews.slice(0, reviewsExpanded ? undefined : 2).map((book) => (
                <MotionPressable
                  key={book.hiveId}
                  accessibilityRole="button"
                  accessibilityLabel={`Read review of ${book.title}`}
                  onPress={() => router.push(`/book/${book.hiveId}`)}
                >
                  <View style={[styles.reviewExcerpt, { borderLeftColor: colors.primary }]}>
                    <ThemedText type="label">{book.title}</ThemedText>
                    {book.stars != null && book.stars > 0 && <StarDisplay rating={book.stars} />}
                    <ThemedText numberOfLines={4}>
                      {parseHtmlToText(book.review ?? "")
                        .replace(/\s+/g, " ")
                        .trim()}
                    </ThemedText>
                  </View>
                </MotionPressable>
              ))}
              {reviews.length > 2 && (
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: reviewsExpanded }}
                  onPress={() => setReviewsExpanded((value) => !value)}
                  style={styles.textAction}
                >
                  <ThemedText type="caption" style={{ color: colors.primary }}>
                    {reviewsExpanded ? "Fewer reviews" : `All ${reviews.length} reviews`}
                  </ThemedText>
                </MotionPressable>
              )}
            </View>
          </View>
        )}

        {/* Empty State */}
        {readingBooks.length === 0 && wantToReadBooks.length === 0 && readBooks.length === 0 && (
          <View style={styles.emptyState}>
            <View
              style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}
            >
              <Ionicons name="library-outline" size={48} color={colors.tertiaryText} />
            </View>
            <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
              No Books Yet
            </ThemedText>
            <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
              {did === authState?.did
                ? "Find a book and choose a reading status to start your profile."
                : "This reader hasn't added any books yet."}
            </ThemedText>
            {did === authState?.did && (
              <ThemedButton
                title="Find books"
                onPress={() => router.push("/search")}
                style={{ marginTop: 16 }}
              />
            )}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 24,
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
    padding: 0,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerBio: {
    lineHeight: 20,
  },
  headerTitle: {
    marginBottom: 2,
  },
  headerSubtitle: {
    lineHeight: 18,
  },
  profileSection: {
    margin: 0,
  },
  profileCard: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statsButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  profileImageContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  profileImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    height: 28,
  },
  section: {
    gap: 0,
  },
  reviewExcerpt: {
    paddingLeft: 16,
    paddingVertical: 4,
    borderLeftWidth: 2,
    gap: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginBottom: 8,
    gap: 8,
  },
  sectionHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  sectionTitle: {
    flex: 1,
  },
  textAction: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingRight: 12,
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
});
