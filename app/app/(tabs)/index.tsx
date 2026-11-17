import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { HomeBookSection } from "@/components/home/HomeBookSection";
import { HomeShelvesSection } from "@/components/home/HomeShelvesSection";
import { CreateListModal } from "@/components/CreateListModal";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ListItem } from "@/components/ListItem";
import { SectionHeader } from "@/components/SectionHeader";
import { StatsCard } from "@/components/StatsCard";
import { ThemedText } from "@/components/ThemedText";
import { HeaderAction } from "@/components/HeaderAction";
import { ThemedView } from "@/components/ThemedView";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";
import { useAdaptiveLayout } from "@/hooks/useAdaptiveLayout";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { BOOK_STATUS } from "@/constants";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useProfile, useUserLists } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { calendarDate } from "@/utils/calendarDate";
import { Ionicons } from "@expo/vector-icons";
import { isThisMonth, isThisYear } from "date-fns";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";

export default function HomeScreen() {
  const router = useRouter();
  const profile = useProfile();
  const { authState } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createShelfVisible, setCreateShelfVisible] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const top = useScreenTopInset();
  const { wide, page } = useAdaptiveLayout();

  const listsQuery = useUserLists(authState?.did);
  const { refetch: refetchProfile } = profile;
  const { refetch: refetchLists } = listsQuery;

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all([refetchProfile(), refetchLists()]).finally(() => setIsRefreshing(false));
  }, [refetchProfile, refetchLists]);

  const stats = useMemo(() => {
    if (!profile.data) return { totalRead: 0, thisMonth: 0, thisYear: 0 };
    const finishedBooks = profile.data.books.filter((book) => book.status === BOOK_STATUS.FINISHED);
    const totalRead = finishedBooks.length;
    const thisMonth = finishedBooks.filter(
      (book) => book.finishedAt && isThisMonth(calendarDate(book.finishedAt)),
    ).length;
    const thisYear = finishedBooks.filter(
      (book) => book.finishedAt && isThisYear(calendarDate(book.finishedAt)),
    ).length;
    return { totalRead, thisMonth, thisYear };
  }, [profile.data]);

  const handleStatPress = useCallback(
    (label: string) => {
      if (label === "Total Read") {
        router.push("/books/finished" as any);
      } else if (label === "This Month" || label === "This Year") {
        if (authState?.did) router.push(`/profile/${authState.did}/stats` as any);
      }
    },
    [authState, router],
  );

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

  if (profile.error && !profile.data) {
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

  const shelves = (
    <HomeShelvesSection
      shelves={listsQuery.data?.lists ?? []}
      onCreatePress={() => setCreateShelfVisible(true)}
    />
  );
  const recentActivity = (
    <View style={styles.supportSection}>
      <SectionHeader icon="time" title="Recent activity" style={{ paddingHorizontal: 0 }} />
      {(profile.data.activity ?? []).slice(0, 3).map((activity, index) => (
        <ListItem
          key={`${activity.hiveId}:${activity.type}:${index}`}
          icon="book"
          title={activity.title}
          subtitle={
            (
              {
                finished: "Finished reading",
                started: "Started reading",
                rated: "Rated",
                review: "Reviewed",
              } as Record<string, string>
            )[activity.type] ?? "Updated"
          }
          onPress={() => router.push(`/book/${activity.hiveId}`)}
        />
      ))}
      {(profile.data.activity ?? []).length === 0 && (
        <ThemedText style={{ color: colors.secondaryText }}>
          Your reading updates will appear here.
        </ThemedText>
      )}
    </View>
  );
  const community = (
    <View style={styles.supportSection}>
      <SectionHeader icon="people" title="Community" style={{ paddingHorizontal: 0 }} />
      <ListItem
        icon="people"
        title="Community feed"
        subtitle="See what other readers are reading and reviewing."
        onPress={() => router.push("/feed")}
      />
    </View>
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
      <View style={{ paddingTop: top }}>
        <ScreenHeader
          title="Home"
          actions={
            <HeaderAction
              accessibilityLabel="Find a book"
              onPress={() => router.navigate("/explore")}
            >
              <Ionicons name="search-outline" size={20} color={colors.accentForeground} />
            </HeaderAction>
          }
        />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[page, wide && styles.tabletContent]}
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
        {profile.error && (
          <ThemedText
            accessibilityRole="alert"
            style={{ paddingHorizontal: 20, color: colors.error }}
          >
            Could not refresh your reading. Pull down to try again.
          </ThemedText>
        )}
        <View
          testID={wide ? "tablet-reading-panel" : undefined}
          style={
            wide ? [styles.readingPanel, { backgroundColor: colors.cardBackground }] : undefined
          }
        >
          <HomeBookSection
            books={readingBooks}
            title="Currently Reading"
            icon="book"
            emptyMessage="What are you reading?"
            emptySubtitle="Find a book, then choose Reading to keep it here."
            status={BOOK_STATUS.READING}
          />

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
        </View>
        {wide ? (
          <View style={styles.dashboard}>
            <View
              style={[
                styles.column,
                styles.supportPanel,
                { backgroundColor: colors.cardBackground },
              ]}
            >
              {shelves}
              {community}
            </View>
            <View
              style={[
                styles.column,
                styles.supportPanel,
                { backgroundColor: colors.cardBackground },
              ]}
            >
              {recentActivity}
            </View>
          </View>
        ) : (
          <>
            {shelves}
            {recentActivity}
            {community}
          </>
        )}

        <View style={[styles.bottomSpacing, { height: 20 + bottom }]} />
      </ScrollView>

      <CreateListModal visible={createShelfVisible} onClose={() => setCreateShelfVisible(false)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tabletContent: { paddingHorizontal: 20, paddingTop: 8 },
  readingPanel: { paddingTop: 24, borderRadius: 28, marginBottom: 24 },
  supportPanel: { paddingTop: 24, borderRadius: 28 },
  supportSection: { paddingHorizontal: 20, gap: 8, marginBottom: 24 },
  dashboard: { flexDirection: "row", gap: 24, alignItems: "flex-start" },
  column: { flex: 1, minWidth: 0 },
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
  statsSection: {
    margin: 20,
    marginTop: 0,
    paddingVertical: 8,
    paddingHorizontal: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  bottomSpacing: {
    height: 20,
  },
});
