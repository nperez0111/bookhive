import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";

import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { BookCard } from "@/components/BookCard";
import { AnimatedListItem } from "@/components/AnimatedListItem";
import { GradientView } from "@/components/GradientView";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { getBaseUrl } from "@/context/auth";
import { useAuthorBooks } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

export default function AuthorBooksScreen() {
  const { author } = useLocalSearchParams<{ author: string }>();
  const [page, setPage] = useState(1);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");

  const decodedAuthor = decodeURIComponent(author ?? "");
  const { data, isLoading, error, refetch } = useAuthorBooks(decodedAuthor, page);

  const books = data?.books ?? [];
  const hasMore = page < (data?.totalPages ?? 1);

  if (isLoading) {
    return (
      <ThemedView style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </ThemedView>
    );
  }

  if (error) {
    return (
      <QueryErrorHandler error={error} onRetry={() => refetch()} showRetryButton showGoBackButton />
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <GradientView variant="warm" style={styles.header}>
        <BackNavigationHeader title={decodedAuthor} />
        <ThemedText
          style={[styles.bookCount, { color: colorScheme === "dark" ? "#f7fafc" : "#4a5568" }]}
          type="caption"
        >
          {data?.totalBooks ?? 0} books
        </ThemedText>
      </GradientView>

      <FlatList
        data={books}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <View style={styles.gridItem}>
            <AnimatedListItem index={index}>
              <BookCard
                title={item.title}
                authors={item.authors}
                imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${item.cover || item.thumbnail}`}
                onPress={() => router.push(`/book/${item.id}` as any)}
                orientation="horizontal"
                style={styles.bookCard}
              />
            </AnimatedListItem>
          </View>
        )}
        ListFooterComponent={
          hasMore ? (
            <Pressable
              onPress={() => setPage((p) => p + 1)}
              style={[styles.loadMoreButton, { backgroundColor: colors.activeBackground }]}
            >
              <ThemedText type="label" style={{ color: colors.primary }}>
                Load more
              </ThemedText>
            </Pressable>
          ) : null
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
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  bookCount: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
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
  bookCard: {
    alignItems: "center",
    paddingBottom: 8,
  },
  loadMoreButton: {
    margin: 16,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
});
