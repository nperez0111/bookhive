import React, { useState, useEffect } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { useCreateList, useUpdateList } from "@/hooks/useBookhiveQuery";

interface CreateListModalProps {
  visible: boolean;
  onClose: () => void;
  editList?: { uri: string; name: string; description?: string };
}

export function CreateListModal({ visible, onClose, editList }: CreateListModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createList = useCreateList();
  const updateList = useUpdateList();
  const isPending = createList.isPending || updateList.isPending;

  useEffect(() => {
    if (visible) {
      setName(editList?.name ?? "");
      setDescription(editList?.description ?? "");
    }
  }, [visible, editList]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    try {
      if (editList) {
        await updateList.mutateAsync({
          uri: editList.uri,
          name: trimmedName,
          description: description.trim() || undefined,
        });
      } else {
        await createList.mutateAsync({
          name: trimmedName,
          description: description.trim() || undefined,
        });
      }
      onClose();
    } catch (error) {
      console.error("Failed to save list:", error);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
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
              {editList ? "Edit List" : "Create List"}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <ThemedText style={{ color: colors.primary }} type="label">
                Cancel
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <ThemedText type="label" style={{ color: colors.secondaryText, marginBottom: 6 }}>
                Name
              </ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g., Summer Reading List"
                placeholderTextColor={colors.tertiaryText}
                style={[
                  styles.input,
                  {
                    color: colors.primaryText,
                    borderColor: colors.cardBorder,
                    backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#fafafa",
                  },
                ]}
                maxLength={100}
                autoFocus
              />
            </View>

            <View style={styles.field}>
              <ThemedText type="label" style={{ color: colors.secondaryText, marginBottom: 6 }}>
                Description (optional)
              </ThemedText>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What's this list about?"
                placeholderTextColor={colors.tertiaryText}
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    color: colors.primaryText,
                    borderColor: colors.cardBorder,
                    backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#fafafa",
                  },
                ]}
                multiline
                numberOfLines={3}
                maxLength={500}
              />
            </View>
          </View>

          <Pressable
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!name.trim() || isPending) && styles.submitDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!name.trim() || isPending}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={styles.submitText} type="label">
                {editList ? "Save Changes" : "Create List"}
              </ThemedText>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
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
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  form: {
    gap: 16,
  },
  field: {},
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitButton: {
    marginTop: 24,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});
