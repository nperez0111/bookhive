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
          backgroundColor:
            colorScheme === "dark"
              ? "rgba(15, 20, 25, 0.95)"
              : "rgba(255, 255, 255, 0.95)",
        },
      ]}
    />
  );
}

export function useBottomTabOverflow() {
  return 0;
}
