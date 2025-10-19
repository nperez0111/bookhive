import React, { useState, useEffect } from "react";
import { View, Pressable, StyleSheet, Platform, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ThemedText } from "./ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

interface DatePickerModalProps {
  visible: boolean;
  title: string;
  initialDate?: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

export const DatePickerModal: React.FC<DatePickerModalProps> = ({
  visible,
  title,
  initialDate,
  minimumDate,
  maximumDate,
  onConfirm,
  onCancel,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const [tempDate, setTempDate] = useState<Date | null>(null);

  // Initialize temp date when modal opens
  useEffect(() => {
    if (visible) {
      setTempDate(initialDate || new Date());
    }
  }, [visible, initialDate]);

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) {
      setTempDate(selectedDate);
    }
  };

  const handleConfirm = () => {
    if (tempDate) {
      onConfirm(tempDate);
    }
  };

  const handleCancel = () => {
    setTempDate(null);
    onCancel();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: colors.cardBackground },
          ]}
        >
          <View style={styles.modalHeader}>
            <ThemedText
              style={[styles.modalTitle, { color: colors.primaryText }]}
              type="heading"
            >
              {title}
            </ThemedText>
            <Pressable onPress={handleCancel} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.primaryText} />
            </Pressable>
          </View>

          <View style={styles.pickerContainer}>
            <DateTimePicker
              value={tempDate || new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={handleDateChange}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              style={styles.datePicker}
            />
          </View>

          {/* Action Buttons */}
          <View style={styles.modalActions}>
            <Pressable
              style={[
                styles.cancelButton,
                { borderColor: colors.buttonBorder },
              ]}
              onPress={handleCancel}
            >
              <ThemedText
                style={[styles.cancelButtonText, { color: colors.primaryText }]}
              >
                Cancel
              </ThemedText>
            </Pressable>

            <Pressable
              style={[
                styles.confirmButton,
                { backgroundColor: colors.primary },
              ]}
              onPress={handleConfirm}
            >
              <ThemedText
                style={[styles.confirmButtonText, { color: colors.background }]}
              >
                Confirm
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    maxWidth: 400,
    borderRadius: 16,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 0, 0, 0.1)",
  },
  modalTitle: {
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  pickerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  datePicker: {
    width: "100%",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
