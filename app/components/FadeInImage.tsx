import React from "react";
import { Image, ImageProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const AnimatedImage = Animated.createAnimatedComponent(Image);

export function FadeInImage(props: ImageProps) {
  const opacity = useSharedValue(0);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <AnimatedImage
      {...props}
      onLoadEnd={() => {
        // Reanimated shared values are mutable animation handles, not React state.
        // eslint-disable-next-line react-hooks/immutability
        opacity.value = withTiming(1, { duration: 200 });
        props.onLoadEnd?.();
      }}
      style={[props.style as any, style]}
      fadeDuration={0}
    />
  );
}
