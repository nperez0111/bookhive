import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

export type SheetAction = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Selection rows expose their state without using a decorative icon tile. */
  selected?: boolean;
  onPress: () => void;
};

type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
};

/** Themed bottom sheet of actions, used instead of `Alert.alert` for menus with several options. */
export function ActionSheet({ visible, onClose, title, subtitle, actions }: ActionSheetProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const { bottom } = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const visibleActions = actions.filter(Boolean);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.cardBorder,
              paddingBottom: 16 + bottom,
              maxHeight: height * 0.85,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.cardBorder }]} />

          {title ? (
            <View style={styles.header}>
              <ThemedText type="heading" style={{ color: colors.primaryText }} numberOfLines={2}>
                {title}
              </ThemedText>
              {subtitle ? (
                <ThemedText
                  type="caption"
                  style={{ color: colors.secondaryText, marginTop: 2 }}
                  numberOfLines={2}
                >
                  {subtitle}
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.actions}>
            {visibleActions.map((action) => {
              const tint = action.destructive ? colors.error : colors.primaryText;
              return (
                <Pressable
                  key={action.key}
                  accessibilityRole={action.selected !== undefined ? "radio" : "button"}
                  accessibilityState={{
                    checked: action.selected,
                    disabled: action.disabled || action.busy,
                    busy: action.busy,
                  }}
                  onPress={action.onPress}
                  disabled={action.disabled || action.busy}
                  style={({ pressed }) => [
                    styles.action,
                    {
                      backgroundColor: pressed ? colors.activeBackground : "transparent",
                      opacity: action.disabled ? 0.4 : 1,
                    },
                  ]}
                >
                  <View style={styles.actionIcon}>
                    {action.busy ? (
                      <ActivityIndicator size="small" color={tint} />
                    ) : (
                      <Ionicons
                        name={
                          action.selected !== undefined
                            ? action.selected
                              ? "checkmark"
                              : "ellipse-outline"
                            : action.icon
                        }
                        size={18}
                        color={action.destructive ? colors.error : colors.primary}
                      />
                    )}
                  </View>
                  <View style={styles.actionText}>
                    <ThemedText type="body" style={{ color: tint }}>
                      {action.label}
                    </ThemedText>
                    {action.description ? (
                      <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                        {action.description}
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.cancel,
              {
                borderColor: colors.cardBorder,
                backgroundColor: pressed ? colors.activeBackground : "transparent",
              },
            ]}
          >
            <ThemedText type="label" style={{ color: colors.secondaryText }}>
              Cancel
            </ThemedText>
          </Pressable>
        </View>
      </View>
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
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  header: {
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  actions: {
    gap: 2,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 48,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  actionIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    flex: 1,
  },
  cancel: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
});
