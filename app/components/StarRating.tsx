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
  starSize = 48,
  style,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  // Internal state represents 0-5 stars (including halves) based on 0-10 rating prop
  const [currentRating, setCurrentRating] = useState(
    rating !== undefined ? rating / 2 : 0,
  );
  const starPositionsRef = useRef<Array<{ x: number; width: number }>>([]);
  const lastTouchXRef = useRef<number | null>(null);

  useEffect(() => {
    // Update internal state if the prop changes (e.g., after successful fetch/mutation)
    setCurrentRating(rating !== undefined ? rating / 2 : 0);
  }, [rating]);

  const calculateRating = (gestureX: number): number => {
    const starPositions = starPositionsRef.current;
    if (starPositions.length === 0) return currentRating;

    // Find the closest star to the touch position
    let closestStarIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < starPositions.length; i++) {
      const star = starPositions[i];
      const starCenter = star.x + star.width / 2;
      const distance = Math.abs(gestureX - starCenter);

      if (distance < minDistance) {
        minDistance = distance;
        closestStarIndex = i;
      }
    }

    // Determine if it's a half-star or full-star based on touch position relative to star center
    const closestStar = starPositions[closestStarIndex];
    const starCenter = closestStar.x + closestStar.width / 2;
    const relativeX = gestureX - closestStar.x;
    const starHalfWidth = closestStar.width / 2;

    if (relativeX < starHalfWidth) {
      // Left half of the star
      return Math.max(0.5, closestStarIndex + 0.5);
    } else {
      // Right half of the star
      return Math.min(5, closestStarIndex + 1);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (evt) => {
        const newRating = calculateRating(evt.nativeEvent.pageX);
        setCurrentRating(newRating);
        lastTouchXRef.current = evt.nativeEvent.pageX;
      },
      onPanResponderMove: (evt) => {
        const currentX = evt.nativeEvent.pageX;
        const lastX = lastTouchXRef.current;

        // Only update if the movement is significant enough (prevents jitter)
        if (lastX === null || Math.abs(currentX - lastX) > 5) {
          const newRating = calculateRating(currentX);
          setCurrentRating(newRating);
          lastTouchXRef.current = currentX;
        }
      },
      onPanResponderRelease: () => {
        // Call the onRate callback only when the gesture ends
        onRate(currentRating * 2); // Convert 0-5 (half steps) back to 0-10
        lastTouchXRef.current = null;
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
          paddingVertical: 8,
          paddingHorizontal: 16,
        },
        style,
      ]}
      {...panResponder.panHandlers} // Attach gesture handlers to outer container
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
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
              }}
              onLayout={(event) => {
                // Track each star's position
                const { width, x } = event.nativeEvent.layout;
                starPositionsRef.current[index] = { width, x };
              }}
            >
              <Ionicons
                name={iconName}
                size={starSize}
                color={starColor}
                style={{
                  textShadowColor:
                    starColor === colors.primary
                      ? colors.primary
                      : "transparent",
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 4,
                }}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
};
