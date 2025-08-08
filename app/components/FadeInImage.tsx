import React, { useState } from "react";
import { Image, ImageProps } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const AnimatedImage = Animated.createAnimatedComponent(Image);

export function FadeInImage(props: ImageProps) {
  const opacity = useSharedValue(0);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <AnimatedImage
      {...props}
      onLoadEnd={() => {
        opacity.value = withTiming(1, { duration: 200 });
      }}
      style={[props.style as any, style]}
      fadeDuration={0}
    />
  );
}
