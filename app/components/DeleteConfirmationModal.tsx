import React from "react";
import { Modal, Pressable, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { ThemedView } from "./ThemedView";
import { ThemedButton } from "./ThemedButton";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

interface DeleteConfirmationModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  isPending?: boolean;
}

export const DeleteConfirmationModal: React.FC<
  DeleteConfirmationModalProps
> = ({
  visible,
  onClose,
  onConfirm,
  title = "Delete Book",
  message = "Are you sure you want to delete this book? This action cannot be undone.",
  isPending = false,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <ThemedView
          style={[
            styles.modalView,
            {
              backgroundColor: colorScheme === "dark" ? "#1f2937" : "#ffffff",
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View
            style={[
              styles.modalHeader,
              {
                borderBottomColor:
                  colorScheme === "dark"
                    ? "rgba(255, 255, 255, 0.1)"
                    : "rgba(0, 0, 0, 0.1)",
              },
            ]}
          >
            <ThemedText
              style={[
                styles.modalTitle,
                { color: colorScheme === "dark" ? "white" : colors.text },
              ]}
              type="heading"
            >
              {title}
            </ThemedText>
            <Pressable onPress={onClose}>
              <Ionicons
                name="close"
                size={24}
                color={colorScheme === "dark" ? "#9CA3AF" : colors.icon}
              />
            </Pressable>
          </View>

          <View style={styles.contentContainer}>
            <ThemedText
              style={[
                styles.messageText,
                {
                  color:
                    colorScheme === "dark" ? "#9CA3AF" : colors.secondaryText,
                },
              ]}
              type="body"
            >
              {message}
            </ThemedText>

            <View style={styles.buttonContainer}>
              <ThemedButton
                title="Cancel"
                onPress={onClose}
                variant="secondary"
                style={styles.cancelButton}
              />
              <ThemedButton
                title="Delete"
                onPress={onConfirm}
                variant="primary"
                style={styles.deleteButton}
                disabled={isPending}
                loading={isPending}
              />
            </View>
          </View>
        </ThemedView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalView: {
    margin: 20,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "stretch",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    width: "80%",
    maxHeight: "60%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  messageText: {
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  cancelButton: {
    flex: 1,
  },
  deleteButton: {
    flex: 1,
  },
});
