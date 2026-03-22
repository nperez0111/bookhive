import { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { BookCard } from "@/components/BookCard";
import { CreateListModal } from "@/components/CreateListModal";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { getBaseUrl, useAuth } from "@/context/auth";
import { useListDetails, useRemoveFromList } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

export default function ListDetailScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const { authState } = useAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);

  const decodedUri = decodeURIComponent(uri as string);
  const listQuery = useListDetails(decodedUri);
  const removeFromList = useRemoveFromList();

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    listQuery.refetch().finally(() => setIsRefreshing(false));
  }, [listQuery.refetch]);

  const isOwner = listQuery.data?.list.userDid === authState?.did;

  const handleRemoveItem = useCallback(
    (itemUri: string, title?: string) => {
      Alert.alert("Remove Book", `Remove "${title ?? "this book"}" from the list?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeFromList.mutate({ itemUri }),
        },
      ]);
    },
    [removeFromList],
  );

  if (listQuery.isLoading && !isRefreshing) {
    return (
      <ThemedView style={[styles.container, { backgroundColor }]}>
        <BackNavigationHeader title="List" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </ThemedView>
    );
  }

  if (listQuery.error) {
    return (
      <ThemedView style={[styles.container, { backgroundColor }]}>
        <BackNavigationHeader title="List" />
        <QueryErrorHandler
          error={listQuery.error}
          onRetry={() => listQuery.refetch()}
          showRetryButton
          showGoBackButton
          onGoBack={() => router.back()}
        />
      </ThemedView>
    );
  }

  const list = listQuery.data?.list;
  const items = listQuery.data?.items ?? [];

  return (
    <ThemedView style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
      <BackNavigationHeader
        title={list?.name ?? "List"}
        rightElement={
          isOwner ? (
            <Pressable onPress={() => setEditModalVisible(true)} hitSlop={8}>
              <Ionicons name="pencil" size={22} color={colors.primary} />
            </Pressable>
          ) : undefined
        }
      />

      {list?.description ? (
        <View style={styles.descriptionContainer}>
          <ThemedText style={{ color: colors.secondaryText }} type="body">
            {list.description}
          </ThemedText>
          <ThemedText style={{ color: colors.tertiaryText, marginTop: 4 }} type="caption">
            {items.length} {items.length === 1 ? "book" : "books"}
            {list.userHandle ? ` · by @${list.userHandle}` : ""}
          </ThemedText>
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="book-outline" size={48} color={colors.tertiaryText} />
          <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
            No books yet
          </ThemedText>
          <ThemedText style={{ color: colors.secondaryText, textAlign: "center" }} type="body">
            Add books from book detail pages
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.uri}
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
            <BookCard
              title={item.title ?? "Unknown Title"}
              authors={item.authors ?? "Unknown Author"}
              imageUri={`${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${item.cover || item.thumbnail}`}
              onPress={() => (item.hiveId ? router.push(`/book/${item.hiveId}` as any) : undefined)}
              variant="row"
              rowSize="small"
            >
              {isOwner ? (
                <Pressable
                  onPress={() => handleRemoveItem(item.uri, item.title)}
                  hitSlop={8}
                  style={styles.removeButton}
                >
                  <Ionicons name="close-circle" size={18} color={colors.error} />
                </Pressable>
              ) : null}
            </BookCard>
          )}
        />
      )}

      {isOwner && list && (
        <CreateListModal
          visible={editModalVisible}
          onClose={() => setEditModalVisible(false)}
          editList={{
            uri: list.uri,
            name: list.name,
            description: list.description,
          }}
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
  descriptionContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    textAlign: "center",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  removeButton: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
});
