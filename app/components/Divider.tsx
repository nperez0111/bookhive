import React from "react";
import { View } from "react-native";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

export function Divider({ inset = 0 }: { inset?: number }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  return (
    <View
      style={{
        height: 1,
        backgroundColor: colors.cardBorder,
        marginLeft: inset,
        opacity: colorScheme === "dark" ? 0.5 : 1,
      }}
    />
  );
}
