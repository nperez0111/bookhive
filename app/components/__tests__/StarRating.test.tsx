/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StarRating } from "../StarRating";
import { StyleSheet } from "react-native";

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

it.each([undefined, 0])(
  "describes an unrated value %s without inventing a zero score",
  (rating) => {
    render(<StarRating rating={rating} onRate={jest.fn()} />);
    expect(screen.getByText("Not rated")).toBeTruthy();
    expect(screen.queryByText("0.0 / 5.0")).toBeNull();
    expect(screen.getByLabelText("Clear rating")).toBeDisabled();
  },
);

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

it("gives every half-star a large visible touch target", () => {
  render(<StarRating rating={3} onRate={jest.fn()} />);
  for (let value = 1; value <= 10; value++) {
    const button = screen.getByLabelText(`Rate ${value / 2} out of 5 stars`);
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      minWidth: 52,
      minHeight: 64,
      borderWidth: 1,
    });
  }
  expect(StyleSheet.flatten(screen.getByLabelText("Clear rating").props.style)).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
});
