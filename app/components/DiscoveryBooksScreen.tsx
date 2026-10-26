import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { BookCard } from "@/components/BookCard";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { GradientView } from "@/components/GradientView";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { InfinitePaginationFooter } from "@/components/InfinitePaginationFooter";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

type DiscoveryBook = {
  id: string;
  title: string;
  authors: string;
  cover?: string | null;
  thumbnail?: string | null;
};

type Props = {
  title: string;
  countLabel: string;
  resetKey: string;
  books: DiscoveryBook[];
  isLoading: boolean;
  error: Error | null;
  hasData: boolean;
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  refetch: () => unknown;
  fetchNextPage: () => unknown;
};

/** Shared presentation only: routes own query selection, counts and pagination. */
export function DiscoveryBooksScreen({
  title,
  countLabel,
  resetKey,
  books,
  isLoading,
  error,
  hasData,
  hasNextPage,
  isFetching,
  isFetchingNextPage,
  isFetchNextPageError,
  refetch,
  fetchNextPage,
}: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const { top } = useSafeAreaInsets();

  if (isLoading) {
    return (
      <ThemedView style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </ThemedView>
    );
  }

  if (error && !hasData) {
    return (
      <QueryErrorHandler error={error} onRetry={() => refetch()} showRetryButton showGoBackButton />
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <GradientView variant="warm" style={[styles.header, { paddingTop: top + 16 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
            <Ionicons
              name="chevron-back"
              size={22}
              color={colorScheme === "dark" ? "#fff" : "#1a1a1a"}
            />
          </Pressable>
          <View style={styles.headerTextContainer}>
            <ThemedText
              style={[styles.headerTitle, { color: colorScheme === "dark" ? "#fff" : "#1a1a1a" }]}
              type="title"
              numberOfLines={1}
            >
              {title}
            </ThemedText>
            <ThemedText
              style={[styles.bookCount, { color: colorScheme === "dark" ? "#f7fafc" : "#4a5568" }]}
              type="caption"
            >
              {countLabel}
            </ThemedText>
          </View>
        </View>
      </GradientView>

      <FlatList
        key={resetKey}
        data={books}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <ThemedText style={{ padding: 20 }}>No books found in this language.</ThemedText>
        }
        renderItem={({ item, index }) => (
          <View style={styles.gridItem}>
            <AnimatedListItem index={index}>
              <BookCard
                title={item.title}
                authors={item.authors}
                imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${item.cover || item.thumbnail}`}
                onPress={() => router.push(`/book/${item.id}` as any)}
                variant="dense"
              />
            </AnimatedListItem>
          </View>
        )}
        ListFooterComponent={
          <InfinitePaginationFooter
            error={error}
            isFetchNextPageError={isFetchNextPageError}
            isFetching={isFetching}
            isFetchingNextPage={isFetchingNextPage}
            hasNextPage={hasNextPage}
            fetchNextPage={fetchNextPage}
            refetch={refetch}
          />
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flex: 0,
    paddingBottom: 20,
    borderRadius: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    marginBottom: 2,
  },
  bookCount: {},
  listContent: {
    padding: 16,
  },
  columnWrapper: {
    gap: 12,
    marginBottom: 12,
  },
  gridItem: {
    flex: 1,
  },
});
