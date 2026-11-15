import { fireEvent, render, screen } from "@testing-library/react-native";
import { ActionSheet } from "../ActionSheet";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

it("exposes both dismissal controls as named native buttons", async () => {
  const onClose = jest.fn();
  const props = { visible: true, title: "Filter your books", onClose, actions: [] };
  const view = await render(<ActionSheet {...props} />);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  await fireEvent.press(screen.getByRole("button", { name: "Dismiss" }));
  expect(onClose).toHaveBeenCalledTimes(2);
  await view.rerender(<ActionSheet {...props} visible={false} />);
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});
