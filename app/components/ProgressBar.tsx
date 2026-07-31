import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

type ProgressBarProps = {
  /** 0–1. Values outside the range are clamped. */
  value: number;
  height?: number;
  color?: string;
  trackColor?: string;
  style?: ViewStyle;
};

export function ProgressBar({ value, height = 4, color, trackColor, style }: ProgressBarProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const fill = useSharedValue(clamped);

  useEffect(() => {
    fill.value = withTiming(clamped, { duration: 320 });
  }, [clamped, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <View
      style={[
        styles.track,
        {
          height,
          borderRadius: height,
          backgroundColor: trackColor ?? colors.inactiveBackground,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          {
            height,
            borderRadius: height,
            backgroundColor: color ?? colors.primary,
          },
          fillStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: "hidden",
    width: "100%",
  },
});
