import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { ThemedText } from "./ThemedText";

interface StarRatingProps {
  /** Wire rating: 0 clears; integers 1–10 represent 0.5–5 stars. */
  rating: number | undefined;
  onRate?: (rating: number) => void;
  disabled?: boolean;
  starSize?: number;
  style?: ViewStyle;
}

export const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onRate,
  disabled = !onRate,
  starSize = 48,
  style,
}) => {
  const colors = Colors[useColorScheme() ?? "light"];
  const inactive = disabled || !onRate;

  return (
    <View style={[{ alignItems: "center", gap: 8 }, style]}>
      <ThemedText style={{ color: colors.primary, fontWeight: "600" }}>
        {((rating ?? 0) / 2).toFixed(1)} / 5.0
      </ThemedText>
      {/* Explicit targets avoid mixing screen-space gestures with parent-relative layout.
          Two rows keep all ten half-star choices tappable on narrow screens. */}
      {[0, 5].map((offset) => (
        <View key={offset} style={{ flexDirection: "row", gap: 4 }}>
          {[1, 2, 3, 4, 5].map((step) => {
            const value = offset + step;
            const selected = rating === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Rate ${value / 2} out of 5 stars`}
                accessibilityState={{ selected, disabled: inactive }}
                disabled={inactive}
                onPress={() => {
                  if (!inactive) onRate?.(value);
                }}
                style={({ pressed }) => ({
                  minWidth: 40,
                  minHeight: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  backgroundColor: selected ? colors.activeBackground : "transparent",
                  opacity: inactive ? 0.6 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <Ionicons
                  name={value % 2 ? "star-half-sharp" : "star"}
                  size={Math.min(starSize, 24)}
                  color={selected ? colors.primary : colors.tertiaryText}
                />
                <ThemedText type="caption">{value / 2}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear rating"
        accessibilityState={{ disabled: inactive || !rating }}
        disabled={inactive || !rating}
        onPress={() => {
          if (!inactive) onRate?.(0);
        }}
        style={{ minHeight: 40, justifyContent: "center", opacity: inactive || !rating ? 0.5 : 1 }}
      >
        <ThemedText type="caption">Clear rating</ThemedText>
      </Pressable>
    </View>
  );
};
