import React from "react";
import {
  Modal,
  Pressable,
  View,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { ThemedView } from "./ThemedView";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { BOOK_STATUS_MAP, BOOK_STATUS, type BookStatus } from "@/constants/index";

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

function StatusSelectionContent({
  onClose,
  currentStatus,
  onStatusSelect,
  isPending,
}: StatusSelectionModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      style={[styles.modalBackdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      onPress={onClose}
    >
      <ThemedView
        accessibilityViewIsModal
        style={[
          styles.modalView,
          {
            backgroundColor: colors.cardBackground,
            borderColor: colors.cardBorder,
            maxHeight: Math.max(0, height - insets.top - insets.bottom - 40),
          },
        ]}
        onStartShouldSetResponder={() => true}
      >
        {isPending ? (
          // Loading state - no header, just loading content
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} style={styles.loadingSpinner} />
            <ThemedText style={[styles.loadingText, { color: colors.text }]} type="body">
              Updating your reading status...
            </ThemedText>
            <ThemedText
              style={[
                styles.loadingSubtext,
                {
                  color: colors.secondaryText,
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
                  borderBottomColor: colors.cardBorder,
                },
              ]}
            >
              <ThemedText style={[styles.modalTitle, { color: colors.text }]} type="heading">
                Select Reading Status
              </ThemedText>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close reading status"
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={colors.icon} />
              </Pressable>
            </View>
            <ScrollView style={styles.options} keyboardShouldPersistTaps="handled">
              {STATUS_OPTIONS.map((item, index) => (
                <View key={item}>
                  <TouchableOpacity
                    style={[
                      styles.modalOption,
                      currentStatus === item && {
                        backgroundColor: colors.activeBackground,
                      },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: currentStatus === item }}
                    onPress={() => onStatusSelect(item)}
                  >
                    <ThemedText
                      style={[
                        styles.modalOptionText,
                        {
                          color: colors.text,
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
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                  {index < STATUS_OPTIONS.length - 1 && (
                    <View
                      style={[
                        styles.separator,
                        {
                          backgroundColor: colors.cardBorder,
                        },
                      ]}
                    />
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </ThemedView>
    </Pressable>
  );
}

export const StatusSelectionModal: React.FC<StatusSelectionModalProps> = (props) => (
  <Modal animationType="fade" transparent visible={props.visible} onRequestClose={props.onClose}>
    <SafeAreaProvider>
      <StatusSelectionContent {...props} />
    </SafeAreaProvider>
  </Modal>
);

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
    borderWidth: 1,
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
  },
  options: { flexShrink: 1 },
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
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    flex: 1,
  },
  modalOption: {
    minHeight: 44,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalOptionText: {
    flexShrink: 1,
    textAlign: "center",
    textTransform: "capitalize",
  },
  separator: {
    height: 1,
    marginHorizontal: 16,
  },
});
