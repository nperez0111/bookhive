/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StarRating } from "../StarRating";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#123456" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));

it("maps all ten accessible choices to exact half stars", () => {
  const onRate = jest.fn();
  render(<StarRating rating={undefined} onRate={onRate} />);
  for (let value = 1; value <= 10; value++) {
    fireEvent.press(screen.getByLabelText(`Rate ${value / 2} out of 5 stars`));
    expect(onRate).toHaveBeenLastCalledWith(value);
  }
});

it("uses the current callback and disabled state after rerender", () => {
  const oldCallback = jest.fn();
  const currentCallback = jest.fn();
  const { rerender } = render(<StarRating rating={1} onRate={oldCallback} />);
  rerender(<StarRating rating={7} onRate={currentCallback} />);
  expect(screen.getByText("3.5 / 5.0")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Rate 4.5 out of 5 stars"));
  expect(oldCallback).not.toHaveBeenCalled();
  expect(currentCallback).toHaveBeenLastCalledWith(9);
  rerender(<StarRating rating={7} onRate={currentCallback} disabled />);
  fireEvent.press(screen.getByLabelText("Rate 1 out of 5 stars"));
  expect(currentCallback).toHaveBeenCalledTimes(1);
});

it("clears via a separate action, not an imprecise gesture", () => {
  const onRate = jest.fn();
  render(<StarRating rating={3} onRate={onRate} />);
  fireEvent.press(screen.getByLabelText("Clear rating"));
  expect(onRate).toHaveBeenCalledWith(0);
});
