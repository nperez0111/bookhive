import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { ThemedText } from "@/components/ThemedText";

type ListItemProps = {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  disabled?: boolean;
  style?: any;
};

export function ListItem({
  icon,
  title,
  subtitle,
  onPress,
  right,
  disabled,
  style,
}: ListItemProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.container,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.cardBorder,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      <View style={[styles.left, { gap: 12 }]}>
        {icon ? (
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: colors.activeBackground },
            ]}
          >
            <Ionicons name={icon} size={18} color={colors.primary} />
          </View>
        ) : null}
        <View style={styles.texts}>
          <ThemedText style={{ color: colors.primaryText }} type="body">
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText style={{ color: colors.secondaryText }} type="caption">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        {right}
        {onPress ? (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.tertiaryText}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  texts: {
    flex: 1,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 12,
  },
});
