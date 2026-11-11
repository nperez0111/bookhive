import React, { useMemo } from "react";
import Animated, {
  FadeInDown,
  FadeOutUp,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";

type AnimatedListItemProps = {
  index: number;
  children: React.ReactNode;
  delayPerItemMs?: number;
  /** @deprecated Layout changes now use a short timing transition without overshoot. */
  overshootClamping?: boolean;
};

export function AnimatedListItem({ index, children, delayPerItemMs = 30 }: AnimatedListItemProps) {
  const entering = useMemo(
    () =>
      FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] })
        .delay(Math.min(Math.max(0, index * delayPerItemMs), 90))
        .duration(180)
        .reduceMotion(ReduceMotion.System),
    [index, delayPerItemMs],
  );
  const exiting = useMemo(
    () =>
      FadeOutUp.withTargetValues({ opacity: 0, transform: [{ translateY: -4 }] })
        .duration(120)
        .reduceMotion(ReduceMotion.System),
    [],
  );
  const layout = useMemo(
    () => LinearTransition.duration(180).reduceMotion(ReduceMotion.System),
    [],
  );
  return (
    <Animated.View entering={entering} exiting={exiting} layout={layout}>
      {children}
    </Animated.View>
  );
}
