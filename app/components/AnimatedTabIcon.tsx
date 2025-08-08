import React, { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { IconSymbol, IconSymbolName } from "./ui/IconSymbol";

type AnimatedTabIconProps = {
  name: IconSymbolName;
  color: string;
  size?: number;
  focused: boolean;
};

export function AnimatedTabIcon({
  name,
  color,
  size = 28,
  focused,
}: AnimatedTabIconProps) {
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0.9);

  useEffect(() => {
    if (focused) {
      scale.value = withSpring(1.1, { damping: 12, stiffness: 180 });
      translateY.value = withSpring(-2, { damping: 14, stiffness: 160 });
      opacity.value = withTiming(1, { duration: 150 });
    } else {
      scale.value = withSpring(1, { damping: 16, stiffness: 180 });
      translateY.value = withSpring(0, { damping: 16, stiffness: 160 });
      opacity.value = withTiming(0.9, { duration: 150 });
    }
  }, [focused]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[{ alignItems: "center" }, style]}>
      <IconSymbol size={size} name={name} color={color} />
    </Animated.View>
  );
}
