import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type MotionPressableProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  /** Keep color feedback, but omit movement for controls in moving content. */
  static?: boolean;
};

/** A short, interruptible press, never an entrance or a looping animation. */
export function MotionPressable({
  style,
  pressedStyle = { opacity: 0.8 },
  static: isStatic = false,
  disabled,
  onPressIn,
  onPressOut,
  ...props
}: MotionPressableProps) {
  const [scale] = useState(() => new Animated.Value(1));
  // Start conservatively until the native accessibility preference is known.
  const reduceMotion = useRef(true);
  const [pressed, setPressed] = useState(false);
  if (disabled && pressed) setPressed(false);

  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const updatePreference = (enabled: boolean) => {
      reduceMotion.current = enabled;
      if (enabled) {
        scale.stopAnimation();
        scale.setValue(1);
      }
    };
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      receivedChange = true;
      if (active) updatePreference(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (active && !receivedChange) updatePreference(enabled);
      },
      () => {},
    );
    return () => {
      active = false;
      subscription.remove();
      scale.stopAnimation();
    };
  }, [scale]);

  useEffect(() => {
    if (isStatic || disabled) {
      scale.stopAnimation();
      scale.setValue(1);
    }
  }, [disabled, isStatic, scale]);

  const animatePress = (down: boolean) => {
    setPressed(down);
    if (reduceMotion.current || isStatic || disabled) return;
    // Starting a new timing animation interrupts the previous one at its current value.
    Animated.timing(scale, {
      toValue: down ? 0.96 : 1,
      duration: down ? 90 : 150,
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      style={[style, pressed && !disabled && pressedStyle, { transform: [{ scale }] }]}
      onPressIn={(event) => {
        animatePress(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animatePress(false);
        onPressOut?.(event);
      }}
    />
  );
}
