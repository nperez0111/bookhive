import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

type TextPromptModalProps = {
  visible: boolean;
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  maxLength?: number;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
};

/**
 * Single-field prompt sheet. `Alert.prompt` is iOS-only, so anything that asks
 * for a name (new shelf, rename a synced document) goes through this instead.
 */
export function TextPromptModal({
  visible,
  title,
  message,
  label,
  placeholder,
  initialValue = "",
  submitLabel = "Save",
  maxLength = 100,
  busy = false,
  onClose,
  onSubmit,
}: TextPromptModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.content,
            { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText type="heading" style={{ color: colors.primaryText }}>
                {title}
              </ThemedText>
              {message ? (
                <ThemedText type="caption" style={{ color: colors.secondaryText, marginTop: 2 }}>
                  {message}
                </ThemedText>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <ThemedText type="label" style={{ color: colors.primary }}>
                Cancel
              </ThemedText>
            </Pressable>
          </View>

          {label ? (
            <ThemedText type="label" style={{ color: colors.secondaryText, marginBottom: 6 }}>
              {label}
            </ThemedText>
          ) : null}
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.tertiaryText}
            style={[
              styles.input,
              {
                color: colors.primaryText,
                borderColor: colors.cardBorder,
                backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#fafafa",
              },
            ]}
            maxLength={maxLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => trimmed && !busy && onSubmit(trimmed)}
          />

          <Pressable
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!trimmed || busy) && styles.submitDisabled,
            ]}
            onPress={() => onSubmit(trimmed)}
            disabled={!trimmed || busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={styles.submitText} type="label">
                {submitLabel}
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
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
  },
  headerText: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  submitButton: {
    marginTop: 20,
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
