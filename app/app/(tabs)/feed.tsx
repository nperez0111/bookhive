import { useState, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedListItem } from "@/components/AnimatedListItem";
import { FadeInImage } from "@/components/FadeInImage";
import { GradientView } from "@/components/GradientView";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useFeed } from "@/hooks/useBookhiveQuery";
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
  "buzz.bookhive.defs#owned": "owns",
};

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState<FeedTab>("friends");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const { top } = useSafeAreaInsets();

  const feed = useFeed(activeTab, 1);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    feed.refetch().finally(() => setIsRefreshing(false));
  }, [feed.refetch]);

  const activities = feed.data?.activities ?? [];

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
            onPress={() => setActiveTab(tab.key)}
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
      ) : feed.error ? (
        <QueryErrorHandler
          error={feed.error}
          onRetry={() => feed.refetch()}
          showRetryButton
          showGoBackButton={false}
        />
      ) : activities.length === 0 ? (
        <View style={styles.emptyState}>
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
        </View>
      ) : (
        <FlatList
          data={activities}
          keyExtractor={(item) => `${item.hiveId}_${item.userDid}_${item.createdAt}`}
          style={styles.feedList}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item, index }) => (
            <AnimatedListItem index={index}>
              <Pressable
                onPress={() => router.push(`/book/${item.hiveId}` as any)}
                style={[
                  styles.activityCard,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: colors.cardBorder,
                  },
                ]}
              >
                <FadeInImage
                  source={{
                    uri: `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${item.cover || item.thumbnail}`,
                  }}
                  style={styles.bookCover}
                />
                <View style={styles.activityInfo}>
                  <ThemedText
                    type="overline"
                    style={{ color: colors.secondaryText }}
                    numberOfLines={1}
                  >
                    @{item.userHandle ?? item.userDid}
                  </ThemedText>
                  <ThemedText
                    type="label"
                    style={{ color: colors.primaryText, marginTop: 2 }}
                    numberOfLines={2}
                  >
                    {item.title}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: colors.secondaryText }}
                    numberOfLines={1}
                  >
                    {item.authors}
                  </ThemedText>
                  {item.stars != null && (
                    <ThemedText type="caption" style={{ color: colors.primary, marginTop: 4 }}>
                      {"★".repeat(Math.round(item.stars / 2))}
                    </ThemedText>
                  )}
                  <ThemedText
                    type="caption"
                    style={{ color: colors.tertiaryText, marginTop: 4 }}
                    numberOfLines={1}
                  >
                    {BOOK_STATUS_LABELS[item.status ?? ""] ?? "updated"}
                  </ThemedText>
                </View>
              </Pressable>
            </AnimatedListItem>
          )}
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
    gap: 12,
  },
  activityCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    gap: 12,
    minHeight: 120,
  },
  bookCover: {
    width: 72,
    height: 108,
    borderRadius: 8,
  },
  activityInfo: {
    flex: 1,
    gap: 2,
  },
});
