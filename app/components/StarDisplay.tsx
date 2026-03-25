import React from "react";
import { View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

interface StarDisplayProps {
  /** Rating on 0-10 scale (matching API). Converted to 0-5 stars internally. */
  rating: number;
  size?: "sm" | "md";
  style?: ViewStyle;
}

const SIZE_MAP = { sm: 12, md: 16 } as const;

export function StarDisplay({ rating, size = "sm", style }: StarDisplayProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const starSize = SIZE_MAP[size];
  const stars = rating / 2; // Convert 0-10 to 0-5

  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 1 }, style]}>
      {[0, 1, 2, 3, 4].map((index) => {
        const starValue = index + 1;
        let iconName: React.ComponentProps<typeof Ionicons>["name"] = "star-outline";
        let color = colors.tertiaryText;

        if (stars >= starValue) {
          iconName = "star";
          color = colors.primary;
        } else if (stars > index && stars < starValue) {
          iconName = "star-half-sharp";
          color = colors.primary;
        }

        return <Ionicons key={index} name={iconName} size={starSize} color={color} />;
      })}
    </View>
  );
}
