import React from "react";
import {
  Modal,
  Pressable,
  View,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { ThemedView } from "./ThemedView";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import {
  BOOK_STATUS_MAP,
  BOOK_STATUS,
  type BookStatus,
} from "@/constants/index";

const STATUS_OPTIONS = [
  BOOK_STATUS.FINISHED,
  BOOK_STATUS.READING,
  BOOK_STATUS.WANTTOREAD,
  BOOK_STATUS.ABANDONED,
];

interface StatusSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  currentStatus: BookStatus | null;
  onStatusSelect: (status: BookStatus) => void;
  isPending: boolean;
}

export const StatusSelectionModal: React.FC<StatusSelectionModalProps> = ({
  visible,
  onClose,
  currentStatus,
  onStatusSelect,
  isPending,
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
          {isPending ? (
            // Loading state - no header, just loading content
            <View style={styles.loadingContainer}>
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={styles.loadingSpinner}
              />
              <ThemedText
                style={[
                  styles.loadingText,
                  { color: colorScheme === "dark" ? "white" : colors.text },
                ]}
                type="body"
              >
                Updating your reading status...
              </ThemedText>
              <ThemedText
                style={[
                  styles.loadingSubtext,
                  {
                    color:
                      colorScheme === "dark" ? "#9CA3AF" : colors.secondaryText,
                  },
                ]}
                type="caption"
              >
                Please wait a moment
              </ThemedText>
            </View>
          ) : (
            // Normal state with header and options
            <>
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
                  Select Reading Status
                </ThemedText>
                <Pressable onPress={onClose}>
                  <Ionicons
                    name="close"
                    size={24}
                    color={colorScheme === "dark" ? "#9CA3AF" : colors.icon}
                  />
                </Pressable>
              </View>
              <View>
                {STATUS_OPTIONS.map((item, index) => (
                  <View key={item}>
                    <TouchableOpacity
                      style={[
                        styles.modalOption,
                        currentStatus === item && {
                          backgroundColor: colors.activeBackground,
                        },
                      ]}
                      onPress={() => onStatusSelect(item)}
                    >
                      <ThemedText
                        style={[
                          styles.modalOptionText,
                          {
                            color:
                              colorScheme === "dark" ? "white" : colors.text,
                          },
                          currentStatus === item && {
                            color: colors.primary,
                            fontWeight: "600",
                          },
                        ]}
                        type="body"
                      >
                        {BOOK_STATUS_MAP[item]}
                      </ThemedText>
                      {currentStatus === item && (
                        <Ionicons
                          name="checkmark"
                          size={20}
                          color={colors.primary}
                        />
                      )}
                    </TouchableOpacity>
                    {index < STATUS_OPTIONS.length - 1 && (
                      <View
                        style={[
                          styles.separator,
                          {
                            backgroundColor:
                              colorScheme === "dark"
                                ? "rgba(255, 255, 255, 0.1)"
                                : "rgba(0, 0, 0, 0.1)",
                          },
                        ]}
                      />
                    )}
                  </View>
                ))}
              </View>
            </>
          )}
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
    maxHeight: "50%",
  },
  loadingContainer: {
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingSpinner: {
    marginBottom: 16,
  },
  loadingText: {
    marginBottom: 8,
    textAlign: "center",
  },
  loadingSubtext: {
    textAlign: "center",
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
  modalOption: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalOptionText: {
    textAlign: "center",
    textTransform: "capitalize",
  },
  separator: {
    height: 1,
    marginHorizontal: 16,
  },
});
