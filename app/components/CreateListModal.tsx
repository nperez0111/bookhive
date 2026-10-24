import React, { useState, useRef } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
} from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { useCreateList, useUpdateList } from "@/hooks/useBookhiveQuery";
import { listFormInput } from "@/utils/catalogueLists";

interface CreateListModalProps {
  visible: boolean;
  onClose: () => void;
  editList?: {
    uri: string;
    name: string;
    description?: string;
    ordered?: boolean;
    tags?: string[];
  };
}

export function CreateListModal({ visible, onClose, editList }: CreateListModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const [name, setName] = useState(editList?.name ?? "");
  const [description, setDescription] = useState(editList?.description ?? "");
  const [ordered, setOrdered] = useState(editList?.ordered ?? false);
  const [tags, setTags] = useState(editList?.tags?.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const createList = useCreateList();
  const updateList = useUpdateList();
  const isPending = createList.isPending || updateList.isPending;

  // Reset only for a new editing session, not background refetches of this list.
  const [previous, setPrevious] = useState({ visible, uri: editList?.uri });
  if (previous.visible !== visible || previous.uri !== editList?.uri) {
    setPrevious({ visible, uri: editList?.uri });
    if (visible) {
      setName(editList?.name ?? "");
      setDescription(editList?.description ?? "");
      setOrdered(editList?.ordered ?? false);
      setTags(editList?.tags?.join(", ") ?? "");
      setError(null);
    }
  }

  const close = () => {
    if (!isPending) onClose();
  };

  const handleSubmit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);

    try {
      const input = listFormInput(name, description, ordered, tags);
      if (editList) {
        await updateList.mutateAsync({
          uri: editList.uri,
          ...input,
        });
      } else {
        await createList.mutateAsync(input);
      }
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Couldn't save this list. Please try again.",
      );
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={close} />
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
            <Pressable onPress={close} disabled={isPending} hitSlop={8}>
              <ThemedText style={{ color: colors.primary }} type="label">
                Cancel
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <ThemedText type="caption" style={{ color: colors.secondaryText }}>
              Public catalogue list · visible on your profile. Not a private ebook shelf.
            </ThemedText>
            <View style={styles.field}>
              <ThemedText type="label" style={{ color: colors.secondaryText, marginBottom: 6 }}>
                Name
              </ThemedText>
              <TextInput
                value={name}
                editable={!isPending}
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
                editable={!isPending}
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
            <View style={styles.orderedRow}>
              <ThemedText type="label">Ordered list</ThemedText>
              <Switch
                accessibilityLabel="Ordered list"
                value={ordered}
                onValueChange={setOrdered}
                disabled={isPending}
              />
            </View>
            <ThemedText type="caption" style={{ color: colors.secondaryText }}>
              Keep books in a custom order with move-up and move-down controls.
            </ThemedText>
            <View style={styles.field}>
              <ThemedText type="label" style={{ marginBottom: 6 }}>
                Tags (comma-separated)
              </ThemedText>
              <TextInput
                accessibilityLabel="List tags, comma-separated"
                value={tags}
                onChangeText={setTags}
                editable={!isPending}
                placeholder="e.g., fiction, favorites"
                placeholderTextColor={colors.tertiaryText}
                style={[
                  styles.input,
                  { color: colors.primaryText, borderColor: colors.cardBorder },
                ]}
              />
            </View>
            {error ? (
              <ThemedText accessibilityRole="alert" style={{ color: colors.error }}>
                {error}
              </ThemedText>
            ) : null}
          </ScrollView>

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
    maxHeight: "90%",
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
  orderedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
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
