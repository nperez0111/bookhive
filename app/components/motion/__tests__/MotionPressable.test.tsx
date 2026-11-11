import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, Text } from "react-native";

import { MotionPressable } from "../MotionPressable";
import { ThemedButton } from "@/components/ThemedButton";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#1c1917" }));

let preferenceChanged: (enabled: boolean) => void;
const removeSubscription = jest.fn();

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    _event: string,
    listener: (enabled: boolean) => void,
  ) => {
    preferenceChanged = listener;
    return { remove: removeSubscription };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderPressable(props: Partial<React.ComponentProps<typeof MotionPressable>> = {}) {
  const result = render(
    <MotionPressable accessibilityRole="button" accessibilityLabel="Open book" {...props}>
      <Text>Open</Text>
    </MotionPressable>,
  );
  await act(async () => {});
  return result;
}

it("animates a press and release without triggering navigation until pressed", async () => {
  const onPress = jest.fn();
  await renderPressable({ onPress });
  const timing = jest.spyOn(Animated, "timing");
  const button = screen.getByLabelText("Open book");
  fireEvent(button, "pressIn");
  fireEvent(button, "pressOut");
  expect(timing).toHaveBeenCalledTimes(2);
  expect(onPress).not.toHaveBeenCalled();
  fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it("keeps non-motion feedback and responds to reduced-motion changes while mounted", async () => {
  await renderPressable({ pressedStyle: { opacity: 0.7 } });
  const timing = jest.spyOn(Animated, "timing");
  act(() => preferenceChanged(true));
  fireEvent(screen.getByLabelText("Open book"), "pressIn");
  expect(timing).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Open book")).toHaveStyle({ opacity: 0.7 });
  fireEvent(screen.getByLabelText("Open book"), "pressOut");
  act(() => preferenceChanged(false));
  fireEvent(screen.getByLabelText("Open book"), "pressIn");
  expect(timing).toHaveBeenCalledTimes(1);
});

it("does not let an older native preference read overwrite a change event", async () => {
  let finishRead: (enabled: boolean) => void = () => {};
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  await renderPressable();
  act(() => preferenceChanged(true));
  await act(async () => finishRead(false));
  const timing = jest.spyOn(Animated, "timing");
  fireEvent(screen.getByLabelText("Open book"), "pressIn");
  expect(timing).not.toHaveBeenCalled();
});

it("offers a static escape hatch and removes the accessibility listener on unmount", async () => {
  const { unmount } = await renderPressable({ static: true });
  const timing = jest.spyOn(Animated, "timing");
  fireEvent(screen.getByLabelText("Open book"), "pressIn");
  expect(timing).not.toHaveBeenCalled();
  unmount();
  expect(removeSubscription).toHaveBeenCalledTimes(1);
});

it("exposes busy state without accepting another tap", async () => {
  const onPress = jest.fn();
  const { rerender } = render(<ThemedButton title="Save" onPress={onPress} />);
  await act(async () => {});
  rerender(<ThemedButton title="Save" onPress={onPress} loading />);
  const button = screen.getByRole("button", { name: "Save" });
  expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});
