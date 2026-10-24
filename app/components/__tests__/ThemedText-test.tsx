/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";
import { ThemedText } from "../ThemedText";

jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#123456" }));

it("renders text with the theme color", () => {
  render(<ThemedText>Hello reader!</ThemedText>);
  expect(screen.getByText("Hello reader!")).toHaveStyle({ color: "#123456", fontSize: 16 });
});

it("supports typography and caller style overrides", () => {
  render(
    <ThemedText type="title" style={{ color: "red" }}>
      BookHive
    </ThemedText>,
  );
  expect(screen.getByText("BookHive")).toHaveStyle({
    color: "red",
    fontSize: 32,
    fontWeight: "700",
  });
});
