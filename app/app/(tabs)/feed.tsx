import { useState, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatDistanceToNow } from "date-fns";

import { BookCard } from "@/components/BookCard";
import { GradientView } from "@/components/GradientView";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { StarDisplay } from "@/components/StarDisplay";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { UserBlock } from "@/components/UserBlock";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useFeed, type FeedActivity, type FeedGroup } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

type FeedTab = "friends" | "all" | "tracking";

const TABS: { key: FeedTab; label: string }[] = [
  { key: "friends", label: "Friends" },
  { key: "all", label: "All" },
  { key: "tracking", label: "Tracking" },
];

const BOOK_STATUS_LABELS: Record<string, string> = {
  "buzz.bookhive.defs#finished": "finished reading",
  "buzz.bookhive.defs#reading": "is reading",
  "buzz.bookhive.defs#wantToRead": "wants to read",
  "buzz.bookhive.defs#abandoned": "abandoned",
};

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState<FeedTab>("friends");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const { top } = useSafeAreaInsets();

  const feed = useFeed(activeTab);
  const { refresh, hasNextPage, isFetching, error, fetchNextPage } = feed;

  // These are mutable reading-state snapshots, not immutable historical events.
  // Render server-defined groups as-is; do not re-collapse by status or createdAt.
  const groups = useMemo(
    () =>
      feed.data?.pages.flatMap((page, pageIndex) =>
        (
          page.groups ??
          page.activities.map(
            (activity): FeedGroup => ({
              kind: "single",
              verb: "updated",
              total: 1,
              activities: [activity],
            }),
          )
        ).map((group, index) => ({
          ...group,
          key: `${feed.data?.pageParams[pageIndex] ?? ""}:${index}`,
        })),
      ) ?? [],
    [feed.data],
  );

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refresh().finally(() => setIsRefreshing(false));
  }, [refresh]);

  const onTabChange = useCallback((tab: FeedTab) => {
    setActiveTab(tab);
  }, []);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetching && !error && !isRefreshing) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, error, fetchNextPage, isRefreshing]);

  const renderActivity = useCallback(
    ({ item }: { item: FeedActivity }) => {
      const timeAgo = (() => {
        try {
          return formatDistanceToNow(new Date(item.indexedAt ?? item.createdAt), {
            addSuffix: true,
          });
        } catch {
          return "";
        }
      })();
      const statusLabel = BOOK_STATUS_LABELS[item.status ?? ""] ?? "updated";

      return (
        <BookCard
          title={item.title}
          authors={item.authors}
          imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${item.cover || item.thumbnail}`}
          onPress={() => router.push(`/book/${item.hiveId}` as any)}
          variant="list"
        >
          <UserBlock
            handle={item.userHandle ?? item.userDid}
            avatar={
              item.userAvatar ??
              (item.userHandle ? `${getBaseUrl()}/profile/${item.userHandle}/image` : undefined)
            }
            size="sm"
            onPress={() => router.push(`/profile/${item.userDid}` as any)}
            suffix={`${statusLabel} ${timeAgo}`}
          />
          {item.stars != null && item.stars > 0 && (
            <StarDisplay rating={item.stars} size="sm" style={{ marginTop: 4 }} />
          )}
          {item.review ? (
            <ThemedText
              type="caption"
              style={{ color: colors.secondaryText, marginTop: 4, fontStyle: "italic" }}
              numberOfLines={2}
            >
              {item.review}
            </ThemedText>
          ) : null}
        </BookCard>
      );
    },
    [colors],
  );

  const renderItem = ({ item }: { item: FeedGroup }) => {
    const actor = item.activities[0];
    if (!actor) return null;
    if (item.kind === "single") return renderActivity({ item: actor });
    return (
      <View style={{ gap: 12 }}>
        <UserBlock
          handle={actor.userHandle ?? actor.userDid}
          avatar={actor.userAvatar}
          onPress={() => router.push(`/profile/${actor.userDid}` as any)}
          suffix={`logged ${item.total}${item.truncated ? "+" : ""} books · ${formatDistanceToNow(new Date(actor.indexedAt ?? actor.createdAt), { addSuffix: true })}`}
        />
        {item.activities.map((activity) => (
          <View key={`${activity.userDid}:${activity.hiveId}`}>
            {renderActivity({ item: activity })}
          </View>
        ))}
        {item.total > item.activities.length && (
          <Pressable
            style={{ minHeight: 44, justifyContent: "center" }}
            onPress={() => router.push(`/profile/${actor.userDid}` as any)}
          >
            <ThemedText type="caption">
              {item.total - item.activities.length} more in this group · View reader’s library
            </ThemedText>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
      <GradientView variant="warm" style={[styles.header, { paddingTop: top + 12 }]}>
        <ThemedText
          style={[styles.headerTitle, { color: colorScheme === "dark" ? "#ffffff" : "#1a1a1a" }]}
          type="title"
        >
          Activity Feed
        </ThemedText>
      </GradientView>

      {/* Tab Selector */}
      <View style={[styles.tabRow, { borderBottomColor: colors.cardBorder }]}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={[
              styles.tab,
              activeTab === tab.key && {
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
          >
            <ThemedText
              type="label"
              style={{
                color: activeTab === tab.key ? colors.primary : colors.secondaryText,
              }}
            >
              {tab.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {feed.isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : feed.error && !groups.length ? (
        <QueryErrorHandler
          error={feed.error}
          onRetry={() => feed.refetch()}
          showRetryButton
          showGoBackButton={false}
        />
      ) : groups.length === 0 && !isRefreshing ? (
        <ScrollView
          contentContainerStyle={[styles.emptyState, { flexGrow: 1 }]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <View style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}>
            <Ionicons name="people-outline" size={40} color={colors.tertiaryText} />
          </View>
          <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
            {activeTab === "friends"
              ? "No friend activity yet"
              : activeTab === "tracking"
                ? "No activity on tracked books"
                : "No activity yet"}
          </ThemedText>
          <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
            {activeTab === "friends"
              ? "Follow users to see their reading activity"
              : activeTab === "tracking"
                ? "Add books to your library to track community activity"
                : "Check back soon"}
          </ThemedText>
        </ScrollView>
      ) : (
        <FlatList
          key={activeTab}
          data={groups}
          keyExtractor={(item) => item.key}
          style={styles.feedList}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={renderItem}
          ListFooterComponent={
            feed.error ? (
              <QueryErrorHandler
                error={feed.error}
                onRetry={() => (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())}
                showRetryButton
                showGoBackButton={false}
              />
            ) : feed.isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flex: 0,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    marginBottom: 0,
  },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 20,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    textAlign: "center",
    lineHeight: 20,
  },
  feedList: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 16,
  },
  gridRow: {
    gap: 12,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: "center",
  },
});
