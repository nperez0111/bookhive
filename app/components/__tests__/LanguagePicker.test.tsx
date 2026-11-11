import { fireEvent, render } from "@testing-library/react-native";
import { LanguagePicker } from "../LanguagePicker";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaProvider: View, SafeAreaView: View };
});

const props = {
  visible: true,
  languages: ["French", "English", "French"],
  selected: "English",
  onSelect: jest.fn(),
  onClose: jest.fn(),
  onRetry: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

it("shows, searches and selects the catalogue's languages", () => {
  const screen = render(<LanguagePicker {...props} />);
  expect(screen.getAllByText("French")).toHaveLength(1);
  expect(screen.getByRole("radio", { name: "English", checked: true })).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Search languages"), "fren");
  expect(screen.queryByText("English")).toBeNull();
  fireEvent.press(screen.getByText("French"));
  expect(props.onSelect).toHaveBeenCalledWith("French");
  expect(props.onClose).toHaveBeenCalled();
});

it("explains an empty catalogue language list and offers a refresh", () => {
  const screen = render(<LanguagePicker {...props} languages={[]} selected={null} />);
  expect(screen.getByText("No language filters are available in this catalogue yet.")).toBeTruthy();
  fireEvent.press(screen.getByText("Refresh languages"));
  expect(props.onRetry).toHaveBeenCalled();
  fireEvent.press(screen.getByText("All Languages"));
  expect(props.onSelect).toHaveBeenCalledWith(null);
});

it("distinguishes a pending request from an empty catalogue", () => {
  const screen = render(<LanguagePicker {...props} languages={[]} loading />);
  expect(screen.getByText("Loading languages…")).toBeTruthy();
  expect(screen.queryByText("No language filters are available in this catalogue yet.")).toBeNull();
});

it("offers retry on failure without hiding cached languages", () => {
  const screen = render(<LanguagePicker {...props} failed />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByText("English")).toBeTruthy();
  fireEvent.press(screen.getByText("Try again"));
  expect(props.onRetry).toHaveBeenCalled();
});

it("clears the previous search when reopened without changing the selected language", () => {
  const screen = render(<LanguagePicker {...props} />);
  fireEvent.changeText(screen.getByLabelText("Search languages"), "fren");
  fireEvent.press(screen.getByText("Done"));
  expect(props.onSelect).not.toHaveBeenCalled();
  screen.rerender(<LanguagePicker {...props} visible={false} />);
  screen.rerender(<LanguagePicker {...props} />);
  expect(screen.getByLabelText("Search languages").props.value).toBe("");
  expect(screen.getByRole("radio", { name: "English", checked: true })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "All Languages" })).toBeTruthy();
});

it("does not invent language options when the catalogue only supports English", () => {
  const screen = render(<LanguagePicker {...props} languages={["English"]} />);
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.getByText(/not your tracked books or ebooks/)).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Search languages"), "French");
  expect(screen.getByText("No matching languages.")).toBeTruthy();
});
