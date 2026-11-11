import { fireEvent, render, screen } from "@testing-library/react-native";
import { HeaderAction } from "../HeaderAction";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "dark" }));

it("exposes a named action and blocks duplicate actions while loading", () => {
  const onPress = jest.fn();
  const result = render(<HeaderAction title="Upload a book" onPress={onPress} />);
  fireEvent.press(screen.getByRole("button", { name: "Upload a book" }));
  expect(onPress).toHaveBeenCalledTimes(1);
  result.rerender(<HeaderAction accessibilityLabel="Upload a book" loading onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Upload a book" });
  expect(button).toBeDisabled();
  expect(button.props.accessibilityState.busy).toBe(true);
  fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});
