import React from "react";
import { View, StyleSheet } from "react-native";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { ThemedText } from "@/components/ThemedText";

type BadgeProps = {
  label: string | number;
  tone?: "neutral" | "primary" | "success" | "warning" | "error";
  style?: any;
};

export function Badge({ label, tone = "neutral", style }: BadgeProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const backgroundByTone: Record<NonNullable<BadgeProps["tone"]>, string> = {
    neutral: colors.inactiveBackground,
    primary: colors.activeBackground,
    success: "rgba(16,185,129,0.15)",
    warning: "rgba(245,158,11,0.18)",
    error: "rgba(239,68,68,0.18)",
  };
  const textByTone: Record<NonNullable<BadgeProps["tone"]>, string> = {
    neutral: colors.secondaryText,
    primary: colors.primary,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: backgroundByTone[tone] },
        style,
      ]}
    >
      <ThemedText type="overline" style={{ color: textByTone[tone] }}>
        {String(label)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
});
