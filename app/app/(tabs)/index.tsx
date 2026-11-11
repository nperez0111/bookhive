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
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";

export default function HomeScreen() {
  const profile = useProfile();
  const { authState } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createShelfVisible, setCreateShelfVisible] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const top = useScreenTopInset();

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
    [authState],
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
  const wantToReadBooks = profile.data.books.filter(
    (book) => book.status === BOOK_STATUS.WANTTOREAD,
  );
  const finishedBooks = profile.data.books
    .filter((book) => book.status === BOOK_STATUS.FINISHED)
    .sort((a, b) =>
      (b.finishedAt || b.createdAt || "").localeCompare(a.finishedAt || a.createdAt || ""),
    );

  return (
    <ThemedView style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
      <View style={{ paddingTop: top }}>
        <ScreenHeader
          title="Home"
          actions={
            <HeaderAction accessibilityLabel="Find a book" onPress={() => router.push("/search")}>
              <Ionicons name="search-outline" size={20} color={colors.accentForeground} />
            </HeaderAction>
          }
        />
      </View>
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
        {profile.error && (
          <ThemedText
            accessibilityRole="alert"
            style={{ paddingHorizontal: 20, color: colors.error }}
          >
            Could not refresh your reading. Pull down to try again.
          </ThemedText>
        )}
        <HomeBookSection
          books={readingBooks}
          title="Currently Reading"
          icon="book"
          emptyMessage="What are you reading?"
          emptySubtitle="Find a book, then choose Currently Reading to keep it here."
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

        {/* Book Sections */}
        <HomeBookSection
          books={wantToReadBooks}
          title="Want to Read"
          icon="bookmark"
          emptyMessage="No books in your list"
          emptySubtitle="Save books you want to read next."
          status={BOOK_STATUS.WANTTOREAD}
        />

        {finishedBooks.length > 0 && (
          <HomeBookSection
            books={finishedBooks}
            title="Recently finished"
            icon="checkmark-circle"
            emptyMessage="No finished books"
            emptySubtitle="Books you finish will appear here"
            status={BOOK_STATUS.FINISHED}
          />
        )}

        <HomeShelvesSection
          shelves={listsQuery.data?.lists ?? []}
          onCreatePress={() => setCreateShelfVisible(true)}
        />

        <View style={{ paddingHorizontal: 20, gap: 8, marginBottom: 24 }}>
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
          <ListItem icon="people" title="Community feed" onPress={() => router.push("/feed")} />
        </View>

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
