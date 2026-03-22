import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { CreateListModal } from "@/components/CreateListModal";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useUserLists, useAddToList } from "@/hooks/useBookhiveQuery";

interface AddToListSheetProps {
  visible: boolean;
  onClose: () => void;
  hiveId: string;
}

export function AddToListSheet({ visible, onClose, hiveId }: AddToListSheetProps) {
  const { authState } = useAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [addingUri, setAddingUri] = useState<string | null>(null);

  const listsQuery = useUserLists(authState?.did);
  const addToList = useAddToList();
  const lists = listsQuery.data?.lists ?? [];

  const handleAddToList = async (listUri: string) => {
    setAddingUri(listUri);
    try {
      await addToList.mutateAsync({ listUri, hiveId });
      onClose();
    } catch (error) {
      console.error("Failed to add to list:", error);
    } finally {
      setAddingUri(null);
    }
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.content,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.cardBorder,
            },
          ]}
        >
          <View style={styles.header}>
            <ThemedText type="heading" style={{ color: colors.primaryText }}>
              Add to List
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.secondaryText} />
            </Pressable>
          </View>

          <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
            {listsQuery.isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : lists.length === 0 ? (
              <View style={styles.emptyState}>
                <ThemedText
                  style={{ color: colors.secondaryText, textAlign: "center" }}
                  type="body"
                >
                  No lists yet. Create one to get started!
                </ThemedText>
              </View>
            ) : (
              lists.map((list) => (
                <Pressable
                  key={list.uri}
                  style={[styles.listItem, { borderBottomColor: colors.cardBorder }]}
                  onPress={() => handleAddToList(list.uri)}
                  disabled={addingUri === list.uri}
                >
                  <View style={styles.listItemContent}>
                    <Ionicons name="list" size={20} color={colors.primary} />
                    <View style={styles.listItemText}>
                      <ThemedText
                        style={{ color: colors.primaryText }}
                        type="label"
                        numberOfLines={1}
                      >
                        {list.name}
                      </ThemedText>
                      <ThemedText style={{ color: colors.tertiaryText }} type="caption">
                        {list.itemCount ?? 0} books
                      </ThemedText>
                    </View>
                  </View>
                  {addingUri === list.uri ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                  )}
                </Pressable>
              ))
            )}
          </ScrollView>

          <Pressable
            style={[styles.createNewButton, { borderColor: colors.primary }]}
            onPress={() => setCreateModalVisible(true)}
          >
            <Ionicons name="add" size={20} color={colors.primary} />
            <ThemedText style={{ color: colors.primary }} type="label">
              Create New List
            </ThemedText>
          </Pressable>
        </View>
      </Modal>

      <CreateListModal visible={createModalVisible} onClose={() => setCreateModalVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 24,
    paddingBottom: 40,
    maxHeight: "60%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  listScroll: {
    maxHeight: 300,
  },
  loadingContainer: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyState: {
    paddingVertical: 24,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  listItemContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  listItemText: {
    flex: 1,
  },
  createNewButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
});
