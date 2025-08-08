import React from "react";
import Animated, {
  FadeInDown,
  FadeOutUp,
  LinearTransition,
} from "react-native-reanimated";

type AnimatedListItemProps = {
  index: number;
  children: React.ReactNode;
  delayPerItemMs?: number;
  overshootClamping?: boolean;
};

export function AnimatedListItem({
  index,
  children,
  delayPerItemMs = 30,
  overshootClamping = true,
}: AnimatedListItemProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * delayPerItemMs).duration(200)}
      exiting={FadeOutUp.duration(160)}
      layout={LinearTransition.springify()
        .damping(18)
        .stiffness(180)
        .reduceMotion(overshootClamping)}
    >
      {children}
    </Animated.View>
  );
}
