import React from "react";
import { View, ViewProps, StyleSheet } from "react-native";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

export type ThemedCardProps = ViewProps & {
  variant?: "default" | "elevated" | "outlined";
  padding?: "none" | "small" | "medium" | "large";
  children: React.ReactNode;
};

export function ThemedCard({
  variant = "default",
  padding = "medium",
  children,
  style,
  ...otherProps
}: ThemedCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const getCardStyle = () => {
    const baseStyle = {
      borderRadius: 16,
      backgroundColor: colors.cardBackground,
      padding: 0,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    };

    // Padding styles
    switch (padding) {
      case "none":
        baseStyle.padding = 0;
        break;
      case "small":
        baseStyle.padding = 12;
        break;
      case "large":
        baseStyle.padding = 24;
        break;
      default: // medium
        baseStyle.padding = 16;
    }

    // Variant styles
    switch (variant) {
      case "elevated":
        return {
          ...baseStyle,
          shadowColor: colors.shadowMedium,
          shadowOffset: {
            width: 0,
            height: 4,
          },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 6,
        };
      case "outlined":
        return {
          ...baseStyle,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        };
      default:
        return {
          ...baseStyle,
          shadowColor: colors.shadowLight,
          shadowOffset: {
            width: 0,
            height: 2,
          },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 3,
        };
    }
  };

  return (
    <View style={[getCardStyle(), style]} {...otherProps}>
      {children}
    </View>
  );
}
