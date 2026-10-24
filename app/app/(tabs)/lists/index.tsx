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
import { CreateListModal } from "@/components/CreateListModal";
import { QueryErrorHandler } from "@/components/QueryErrorHandler";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useBottomTabOverflow } from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useUserLists, useDeleteList } from "@/hooks/useBookhiveQuery";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";

export default function ListsScreen() {
  const { authState } = useAuth();
  const { did } = useLocalSearchParams<{ did?: string }>();
  const ownerDid = did || authState?.did;
  const isOwner = Boolean(authState?.did && ownerDid === authState.did);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const backgroundColor = useThemeColor({}, "background");
  const bottom = useBottomTabOverflow();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);

  const listsQuery = useUserLists(ownerDid);
  const deleteList = useDeleteList();
  const { refetch } = listsQuery;

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refetch().finally(() => setIsRefreshing(false));
  }, [refetch]);

  const handleDeleteList = useCallback(
    (uri: string, name: string) => {
      Alert.alert("Delete List", `Are you sure you want to delete "${name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deleteList.mutate(
              { uri },
              { onError: (error) => Alert.alert("Couldn't delete list", error.message) },
            ),
        },
      ]);
    },
    [deleteList],
  );

  const lists = listsQuery.data?.lists ?? [];

  return (
    <ThemedView style={[styles.container, { backgroundColor, paddingBottom: bottom }]}>
      <BackNavigationHeader
        title={isOwner ? "Your Public Lists" : "Public Lists"}
        rightElement={
          isOwner ? (
            <Pressable
              accessibilityLabel="Create public list"
              onPress={() => setCreateModalVisible(true)}
              hitSlop={8}
            >
              <Ionicons name="add-circle" size={28} color={colors.primary} />
            </Pressable>
          ) : undefined
        }
      />

      {listsQuery.isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : listsQuery.error ? (
        <QueryErrorHandler
          error={listsQuery.error}
          onRetry={() => listsQuery.refetch()}
          showRetryButton
          showGoBackButton={false}
        />
      ) : lists.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconContainer, { backgroundColor: colors.inactiveBackground }]}>
            <Ionicons name="list-outline" size={40} color={colors.tertiaryText} />
          </View>
          <ThemedText style={[styles.emptyTitle, { color: colors.primaryText }]} type="heading">
            No lists yet
          </ThemedText>
          <ThemedText style={[styles.emptySubtitle, { color: colors.secondaryText }]} type="body">
            {isOwner
              ? "Create a public catalogue list to organize your reads. Private ebook shelves live in your personal library."
              : "This reader hasn't created any public lists yet."}
          </ThemedText>
          {isOwner && (
            <Pressable
              style={[styles.createButton, { backgroundColor: colors.primary }]}
              onPress={() => setCreateModalVisible(true)}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <ThemedText style={styles.createButtonText} type="label">
                Create List
              </ThemedText>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={lists}
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
          renderItem={({ item }) => (
            <Pressable
              style={[
                styles.listCard,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.cardBorder,
                },
              ]}
              onPress={() => router.push(`/lists/${encodeURIComponent(item.uri)}` as any)}
            >
              <View style={styles.listCardContent}>
                <View style={styles.listCardHeader}>
                  <Ionicons name="list" size={20} color={colors.primary} />
                  <ThemedText
                    style={[styles.listName, { color: colors.primaryText }]}
                    type="heading"
                    numberOfLines={1}
                  >
                    {item.name}
                  </ThemedText>
                </View>
                {item.description ? (
                  <ThemedText
                    style={{ color: colors.secondaryText, marginTop: 4 }}
                    type="caption"
                    numberOfLines={2}
                  >
                    {item.description}
                  </ThemedText>
                ) : null}
                <View style={styles.listCardFooter}>
                  <ThemedText style={{ color: colors.tertiaryText }} type="caption">
                    {item.itemCount ?? 0} {(item.itemCount ?? 0) === 1 ? "book" : "books"}
                    {item.ordered ? " · Ordered" : ""}
                  </ThemedText>
                  {isOwner && (
                    <Pressable
                      accessibilityLabel={`Delete ${item.name}`}
                      disabled={deleteList.isPending}
                      onPress={() => handleDeleteList(item.uri, item.name)}
                      hitSlop={8}
                      style={{
                        minHeight: 40,
                        minWidth: 40,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                    </Pressable>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.tertiaryText} />
            </Pressable>
          )}
        />
      )}

      {isOwner && (
        <CreateListModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
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
    marginBottom: 24,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  createButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  listCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  listCardContent: {
    flex: 1,
  },
  listCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  listName: {
    flex: 1,
  },
  listCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
});
