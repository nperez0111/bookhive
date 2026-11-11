import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BookSearchModal } from "../BookSearchModal";
import { TextPromptModal } from "../TextPromptModal";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#fff" }));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useSearchBooks: () => ({ data: [], isLoading: false }),
}));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.buzz" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

it("resets a new matching operation with the same initial title instead of keeping the last target's query", () => {
  const props = {
    visible: true,
    initialQuery: "Same title",
    onClose: jest.fn(),
    onSelectBook: jest.fn(),
  };
  const view = render(<BookSearchModal {...props} operationKey={1} />);
  fireEvent.changeText(
    screen.getByPlaceholderText("Search by title or author"),
    "Previous target query",
  );
  view.rerender(<BookSearchModal {...props} operationKey={2} />);
  expect(screen.getByDisplayValue("Same title")).toBeTruthy();
  expect(screen.queryByDisplayValue("Previous target query")).toBeNull();
});

it("gives same-valued prompts distinct drafts and keeps one synchronous submit owner", async () => {
  let finish!: () => void;
  const onSubmit = jest.fn().mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  const props = {
    visible: true,
    title: "Rename",
    initialValue: "Same name",
    placeholder: "Name",
    onClose: jest.fn(),
    onSubmit,
  };
  const view = render(<TextPromptModal {...props} operationKey={1} />);
  const input = screen.getByPlaceholderText("Name");
  fireEvent.changeText(input, "Old draft");
  act(() => {
    fireEvent(input, "submitEditing");
    fireEvent.press(screen.getByText("Save"));
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  view.rerender(<TextPromptModal {...props} operationKey={2} />);
  expect(screen.getByDisplayValue("Same name")).toBeTruthy();
  await act(async () => {
    finish();
  });
  fireEvent.changeText(screen.getByPlaceholderText("Name"), "New draft");
  expect(screen.getByDisplayValue("New draft")).toBeTruthy();
});
