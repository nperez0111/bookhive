import { View, type ViewProps, StyleSheet } from "react-native";

import { useThemeColor } from "@/hooks/useThemeColor";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  variant?:
    | "default"
    | "card"
    | "surface"
    | "surfaceSecondary"
    | "surfaceTertiary";
};

export function ThemedView({
  style,
  lightColor,
  darkColor,
  variant = "default",
  ...otherProps
}: ThemedViewProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  let backgroundColor;

  if (lightColor || darkColor) {
    backgroundColor = useThemeColor(
      { light: lightColor, dark: darkColor },
      "background",
    );
  } else {
    switch (variant) {
      case "card":
        backgroundColor = colors.cardBackground;
        break;
      case "surface":
        backgroundColor = colors.surfacePrimary;
        break;
      case "surfaceSecondary":
        backgroundColor = colors.surfaceSecondary;
        break;
      case "surfaceTertiary":
        backgroundColor = colors.surfaceTertiary;
        break;
      default:
        backgroundColor = colors.background;
    }
  }

  return (
    <View
      style={[
        { backgroundColor },
        variant === "card" && [
          styles.card,
          {
            borderColor: colors.cardBorder,
            borderWidth: 1,
            shadowColor: colors.shadowLight,
          },
        ],
        style,
      ]}
      {...otherProps}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
});
