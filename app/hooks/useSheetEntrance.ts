import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";

/** Fade the backdrop separately from the sheet's translation. */
export function useSheetEntrance(visible: boolean) {
  const [entrance] = useState(() => new Animated.Value(0));
  useEffect(() => {
    entrance.setValue(0);
    if (!visible) return;
    let active = true;
    const reveal = (reduced: boolean) => {
      if (!active) return;
      entrance.stopAnimation();
      if (reduced) entrance.setValue(1);
      else Animated.timing(entrance, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    };
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", reveal);
    AccessibilityInfo.isReduceMotionEnabled().then(reveal, () => reveal(true));
    return () => {
      active = false;
      subscription.remove();
      entrance.stopAnimation();
    };
  }, [visible, entrance]);
  return entrance;
}
