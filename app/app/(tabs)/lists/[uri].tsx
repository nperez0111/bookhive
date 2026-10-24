import { useState, useCallback, useRef } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
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
import {
  useDeleteList,
  useListDetails,
  useRemoveFromList,
  useReorderList,
} from "@/hooks/useBookhiveQuery";
import { catalogueListUri, moveListItem } from "@/utils/catalogueLists";
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

  const decodedUri = catalogueListUri(uri);
  const listQuery = useListDetails(decodedUri);
  const removeFromList = useRemoveFromList();
  const deleteList = useDeleteList();
  const reorderList = useReorderList();
  const isWriting = removeFromList.isPending || deleteList.isPending || reorderList.isPending;
  const writing = useRef(false);
  const runWrite = useCallback(async (action: () => Promise<unknown>, failureTitle: string) => {
    if (writing.current) return;
    writing.current = true;
    try {
      await action();
    } catch (error) {
      Alert.alert(failureTitle, error instanceof Error ? error.message : "Please try again.");
    } finally {
      writing.current = false;
    }
  }, []);

  const { refetch } = listQuery;
  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refetch().finally(() => setIsRefreshing(false));
  }, [refetch]);

  const isOwner = Boolean(authState?.did && listQuery.data?.list.userDid === authState.did);

  const handleRemoveItem = useCallback(
    (itemUri: string, title?: string) => {
      Alert.alert("Remove Book", `Remove "${title ?? "this book"}" from the list?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void runWrite(
              () => removeFromList.mutateAsync({ itemUri, listUri: decodedUri }),
              "Couldn't remove book",
            );
          },
        },
      ]);
    },
    [removeFromList, decodedUri, runWrite],
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

  if (!decodedUri || listQuery.error) {
    return (
      <ThemedView style={[styles.container, { backgroundColor }]}>
        <BackNavigationHeader title="List" />
        <QueryErrorHandler
          error={listQuery.error ?? new Error("Invalid public list link.")}
          onRetry={() => listQuery.refetch()}
          showRetryButton={Boolean(decodedUri)}
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
            <Pressable
              disabled={isWriting}
              accessibilityLabel="Manage public list"
              onPress={() => {
                const options = ["Edit", "Delete List", "Cancel"];
                const handleAction = (index: number) => {
                  if (index === 0) {
                    setEditModalVisible(true);
                  } else if (index === 1) {
                    Alert.alert(
                      "Delete List",
                      `Delete "${list?.name ?? "this list"}"? Books themselves will not be deleted.`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => {
                            void runWrite(async () => {
                              await deleteList.mutateAsync({ uri: decodedUri });
                              router.back();
                            }, "Couldn't delete list");
                          },
                        },
                      ],
                    );
                  }
                };
                if (Platform.OS === "ios") {
                  ActionSheetIOS.showActionSheetWithOptions(
                    { options, cancelButtonIndex: 2, destructiveButtonIndex: 1 },
                    handleAction,
                  );
                } else {
                  Alert.alert("Manage List", undefined, [
                    { text: "Edit", onPress: () => handleAction(0) },
                    { text: "Delete", style: "destructive", onPress: () => handleAction(1) },
                    { text: "Cancel", style: "cancel" },
                  ]);
                }
              }}
              hitSlop={8}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.primary} />
            </Pressable>
          ) : undefined
        }
      />

      {list ? (
        <View style={styles.descriptionContainer}>
          {list.description ? (
            <ThemedText style={{ color: colors.secondaryText }} type="body">
              {list.description}
            </ThemedText>
          ) : null}
          <ThemedText style={{ color: colors.tertiaryText, marginTop: 4 }} type="caption">
            {items.length} {items.length === 1 ? "book" : "books"}
            {list.userHandle ? ` · by @${list.userHandle}` : ""}
            {list.ordered ? " · Ordered" : ""}
          </ThemedText>
          {list.tags?.length ? (
            <ThemedText type="caption" style={{ color: colors.secondaryText, marginTop: 4 }}>
              {list.tags.join(" · ")}
            </ThemedText>
          ) : null}
          <Pressable
            accessibilityLabel="View list owner's public lists"
            onPress={() =>
              router.push({ pathname: "/lists", params: { did: list.userDid } } as any)
            }
            style={{ minHeight: 40, justifyContent: "center" }}
          >
            <ThemedText style={{ color: colors.primary }} type="caption">
              More public lists from this reader
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="book-outline" size={48} color={colors.tertiaryText} />
          <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
            No books yet
          </ThemedText>
          <ThemedText style={{ color: colors.secondaryText, textAlign: "center" }} type="body">
            {isOwner ? "Add books from book detail pages" : "This public list has no books yet"}
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
              imageUri={
                item.cover || item.thumbnail
                  ? `${getBaseUrl()}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${item.cover || item.thumbnail}`
                  : ""
              }
              onPress={() => (item.hiveId ? router.push(`/book/${item.hiveId}` as any) : undefined)}
              variant="row"
              rowSize="small"
            >
              {isOwner ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {list?.ordered &&
                    ([-1, 1] as const).map((direction) => (
                      <Pressable
                        key={direction}
                        accessibilityLabel={`Move ${item.title ?? "book"} ${direction === -1 ? "up" : "down"}`}
                        accessibilityRole="button"
                        disabled={
                          isWriting || (direction === -1 ? index === 0 : index === items.length - 1)
                        }
                        style={{
                          minHeight: 40,
                          minWidth: 40,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity:
                            isWriting ||
                            (direction === -1 ? index === 0 : index === items.length - 1)
                              ? 0.35
                              : 1,
                        }}
                        onPress={() => {
                          if (isWriting) return;
                          const next = moveListItem(items, item.uri, direction);
                          void runWrite(
                            () =>
                              reorderList.mutateAsync({
                                listUri: decodedUri,
                                itemUris: next.map((entry) => entry.uri),
                              }),
                            "Couldn't reorder list",
                          );
                        }}
                      >
                        <Ionicons
                          name={direction === -1 ? "arrow-up" : "arrow-down"}
                          size={18}
                          color={colors.primary}
                        />
                      </Pressable>
                    ))}
                  <Pressable
                    accessibilityLabel={`Remove ${item.title ?? "book"} from list`}
                    disabled={isWriting}
                    onPress={() => handleRemoveItem(item.uri, item.title)}
                    hitSlop={8}
                    style={styles.removeButton}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
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
            ordered: list.ordered,
            tags: list.tags,
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
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    alignSelf: "flex-start",
  },
});
