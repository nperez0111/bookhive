import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";

import { BookCard } from "@/components/BookCard";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { InfinitePaginationFooter } from "@/components/InfinitePaginationFooter";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { catalogueCoverUrl } from "@/utils/catalogueCover";
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
  const top = useScreenTopInset();
  const bottom = useBottomTabOverflow();

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <View style={{ paddingTop: top }}>
        <BackNavigationHeader title={title} />
        {!isLoading && hasData && (
          <ThemedText
            type="caption"
            style={{ color: colors.secondaryText, paddingHorizontal: 20, paddingBottom: 8 }}
          >
            {countLabel}
          </ThemedText>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !hasData ? (
        <QueryErrorHandler
          error={error}
          onRetry={() => refetch()}
          showRetryButton
          showGoBackButton={false}
        />
      ) : (
        <FlatList
          key={resetKey}
          data={books}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 + bottom }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            !error ? (
              <ThemedText style={{ padding: 20 }}>No books found for this selection.</ThemedText>
            ) : null
          }
          renderItem={({ item, index }) => (
            <View style={styles.gridItem}>
              <AnimatedListItem index={index}>
                <BookCard
                  title={item.title}
                  authors={item.authors}
                  imageUri={catalogueCoverUrl(getBaseUrl(), item)}
                  onPress={() => router.push(`/book/${item.id}` as any)}
                  variant="row"
                  rowSize="small"
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
      )}
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
  gridItem: {
    flex: 1,
  },
});
