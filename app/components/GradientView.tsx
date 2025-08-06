import React from "react";
import { View, ViewProps, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

export type GradientViewProps = ViewProps & {
  variant?: "primary" | "secondary" | "warm" | "cool" | "custom";
  colors?: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  children?: React.ReactNode;
};

export function GradientView({
  style,
  variant = "primary",
  colors,
  start = { x: 0, y: 0 },
  end = { x: 1, y: 1 },
  children,
  ...otherProps
}: GradientViewProps) {
  const colorScheme = useColorScheme();
  const themeColors = Colors[colorScheme ?? "light"];

  const getGradientColors = () => {
    if (colors) return colors;

    switch (variant) {
      case "primary":
        return themeColors.primaryGradient;
      case "secondary":
        return colorScheme === "dark"
          ? ["#2d3748", "#4a5568"]
          : ["#f7fafc", "#edf2f7"];
      case "warm":
        return colorScheme === "dark"
          ? ["#744210", "#92400e"]
          : ["#fed7aa", "#fdba74"];
      case "cool":
        return colorScheme === "dark"
          ? ["#1e3a8a", "#3730a3"]
          : ["#dbeafe", "#bfdbfe"];
      default:
        return themeColors.primaryGradient;
    }
  };

  // Remove backgroundColor from otherProps to avoid conflicts
  const { backgroundColor, ...restProps } = otherProps as any;

  return (
    <LinearGradient
      colors={getGradientColors()}
      start={start}
      end={end}
      style={[styles.container, style]}
      {...restProps}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
