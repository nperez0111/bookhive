import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { PanResponder, View, ViewStyle, Dimensions } from "react-native";
import { ThemedText } from "./ThemedText";

interface StarRatingProps {
  /** rating (0-10, supports half steps like 1, 3, 5...) */
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
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  // Internal state represents 0-5 stars (including halves) based on 0-10 rating prop
  const [currentRating, setCurrentRating] = useState(
    rating !== undefined ? rating / 2 : 0,
  );
  const containerRef = useRef<View>(null);
  const containerLayoutRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    // Update internal state if the prop changes (e.g., after successful fetch/mutation)
    setCurrentRating(rating !== undefined ? rating / 2 : 0);
  }, [rating]);

  const calculateRating = (gestureX: number): number => {
    const containerLayout = containerLayoutRef.current;
    if (!containerLayout) return currentRating;

    // gestureX is now pageX (absolute screen position)
    // We need to calculate relative position within the container
    const relativeX = Math.max(
      0,
      Math.min(1, (gestureX - containerLayout.x) / containerLayout.width),
    );

    // Convert to rating: 0-1 maps to 0-5.0 stars in 0.5 increments
    const rating = relativeX * 5;

    // Round to nearest 0.5 increment
    return Math.round(rating * 2) / 2;
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (evt) => {
        const newRating = calculateRating(evt.nativeEvent.pageX);
        setCurrentRating(newRating);
      },
      onPanResponderMove: (evt) => {
        const newRating = calculateRating(evt.nativeEvent.pageX);
        setCurrentRating(newRating);
      },
      onPanResponderRelease: (evt) => {
        const newRating = calculateRating(evt.nativeEvent.pageX);
        // Call the onRate callback only when the gesture ends
        onRate?.(newRating * 2); // Convert 0-5 (half steps) back to 0-10
      },
    }),
  ).current;

  return (
    <View
      ref={containerRef}
      style={[
        {
          alignItems: "center",
          paddingVertical: 8,
          paddingHorizontal: 16,
        },
        style,
      ]}
      onLayout={(event) => {
        // Track the container's position and width for accurate touch calculations
        const { width, x } = event.nativeEvent.layout;
        containerLayoutRef.current = { width, x };
      }}
      {...panResponder.panHandlers} // Attach gesture handlers to full container
    >
      {/* Rating display text */}
      <ThemedText
        style={{
          textAlign: "center",
          marginBottom: 8,
          fontSize: 16,
          fontWeight: "600",
          color: colors.primary,
        }}
      >
        {currentRating > 0 ? `${currentRating.toFixed(1)} / 5.0` : "0.0 / 5.0"}
      </ThemedText>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          minHeight: starSize + 16, // Ensure adequate touch area
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            width: "100%", // Ensure full width for better touch sensitivity
          }}
        >
          {[0, 1, 2, 3, 4].map((index) => {
            const starValue = index + 1;
            let iconName: React.ComponentProps<typeof Ionicons>["name"] =
              "star-outline";
            let starColor = colors.tertiaryText;

            if (currentRating >= starValue) {
              iconName = "star";
              starColor = colors.primary;
            } else if (currentRating > index && currentRating < starValue) {
              // Handle half stars
              iconName = "star-half-sharp";
              starColor = colors.primary;
            }

            return (
              <View
                key={index}
                style={{
                  marginHorizontal: 6,
                  padding: 4,
                  flex: 1, // Distribute stars evenly across the container width
                  alignItems: "center",
                }}
              >
                <Ionicons name={iconName} size={starSize} color={starColor} />
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
};
