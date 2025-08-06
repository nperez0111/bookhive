import React, { useState, useEffect, useRef } from "react";
import { View, PanResponder, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

interface StarRatingProps {
  /** rating (0-10, supports half steps like 1, 3, 5...) */
  rating: number | undefined;
  onRate: (rating: number) => void;
  disabled?: boolean;
  starSize?: number;
  style?: ViewStyle;
}

export const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onRate,
  disabled = false,
  starSize = 32,
  style,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  // Internal state represents 0-5 stars (including halves) based on 0-10 rating prop
  const [currentRating, setCurrentRating] = useState(
    rating !== undefined ? rating / 2 : 0,
  );
  const layoutRef = useRef({ width: 0, x: 0 }); // Ref to hold layout for handlers

  useEffect(() => {
    // Update internal state if the prop changes (e.g., after successful fetch/mutation)
    setCurrentRating(rating !== undefined ? rating / 2 : 0);
  }, [rating]);

  const calculateRating = (gestureX: number): number => {
    // Use layout from ref inside the calculation triggered by PanResponder
    const layout = layoutRef.current;
    if (!layout.width) return currentRating;

    const relativeX = gestureX - layout.x;
    const touchPercentage = Math.max(0, Math.min(1, relativeX / layout.width));
    const rawRating = touchPercentage * 5; // 0-5 scale

    // Round to nearest half-star
    const halfStarRating = Math.round(rawRating * 2) / 2;
    const finalRating = Math.max(0.5, Math.min(5, halfStarRating)); // Ensure rating is between 0.5 and 5
    return finalRating;
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
      onPanResponderRelease: () => {
        // Call the onRate callback only when the gesture ends
        onRate(currentRating * 2); // Convert 0-5 (half steps) back to 0-10
      },
    }),
  ).current;

  return (
    <View
      style={[
        {
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          marginVertical: 16,
        },
        style,
      ]}
      {...panResponder.panHandlers} // Attach gesture handlers
      onLayout={(event) => {
        // Get the layout info (width and position) of the container
        const { width, x } = event.nativeEvent.layout;
        layoutRef.current = { width, x };
      }}
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const starValue = index + 1;
        let iconName: React.ComponentProps<typeof Ionicons>["name"] =
          "star-outline";
        if (currentRating >= starValue) {
          iconName = "star";
        } else if (currentRating > index && currentRating < starValue) {
          // Handle half stars
          iconName = "star-half-sharp";
        }

        return (
          <View key={index} style={{ marginHorizontal: 2 }}>
            <Ionicons
              name={iconName}
              size={starSize}
              color={
                currentRating >= index + 0.5
                  ? colors.primary
                  : colors.tertiaryText
              }
            />
          </View>
        );
      })}
    </View>
  );
};
