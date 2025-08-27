import { View, StyleSheet } from "react-native";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

export default function TabBarBackground() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colorScheme === "dark" ? "#000000" : "#ffffff",
          borderTopColor: colors.cardBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      ]}
    />
  );
}

export function useBottomTabOverflow() {
  return 0;
}
