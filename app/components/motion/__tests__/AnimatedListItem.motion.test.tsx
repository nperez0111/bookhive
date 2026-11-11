import { render, screen } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { AnimatedListItem } from "@/components/AnimatedListItem";

jest.mock("react-native-reanimated", () => {
  function builder(config: Record<string, unknown> = {}) {
    return {
      config,
      delay: (delay: number) => builder({ ...config, delay }),
      duration: (duration: number) => builder({ ...config, duration }),
      reduceMotion: (reduceMotion: string) => builder({ ...config, reduceMotion }),
      withInitialValues: (initial: unknown) => builder({ ...config, initial }),
      withTargetValues: (target: unknown) => builder({ ...config, target }),
    };
  }
  return {
    __esModule: true,
    default: { View: jest.requireActual("react-native").View },
    FadeInDown: builder(),
    FadeOutUp: builder(),
    LinearTransition: builder(),
    ReduceMotion: { System: "system" },
  };
});

it("honors the system motion preference on every transition", () => {
  render(
    <AnimatedListItem index={100}>
      <Text>Book</Text>
    </AnimatedListItem>,
  );
  const { entering, exiting, layout } = screen.UNSAFE_getByType(View).props;
  for (const transition of [entering, exiting, layout]) {
    expect(transition.config.reduceMotion).toBe("system");
  }
});
