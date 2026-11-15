import { render, screen } from "@testing-library/react-native";
import { Colors } from "@/constants/Colors";
import { useThemeColor } from "@/hooks/useThemeColor";
import { ThemedTextInput } from "../ThemedTextInput";

jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: jest.fn() }));

it.each(["light", "dark"] as const)(
  "themes placeholders in %s mode while preserving explicit overrides",
  async (mode) => {
    jest.mocked(useThemeColor).mockImplementation((_overrides, name) => {
      const value = Colors[mode][name];
      return Array.isArray(value) ? value[0] : value;
    });
    const view = await render(<ThemedTextInput placeholder="Search ebooks" />);
    expect(screen.getByPlaceholderText("Search ebooks")).toHaveProp(
      "placeholderTextColor",
      Colors[mode].placeholderText,
    );
    await view.rerender(
      <ThemedTextInput placeholder="Search ebooks" placeholderTextColor="#abcdef" />,
    );
    expect(screen.getByPlaceholderText("Search ebooks")).toHaveProp(
      "placeholderTextColor",
      "#abcdef",
    );
  },
);
