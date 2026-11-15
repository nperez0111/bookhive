import { act, fireEvent, render } from "@testing-library/react-native";
import { DatePickerModal } from "../DatePickerModal";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: jest.fn(() => "dark") }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: (props: object) => <View testID="date-picker" {...props} /> };
});

it("preserves the selected date across optimistic canonical changes and a failed save", async () => {
  const onConfirm = jest.fn();
  const props = {
    visible: true,
    title: "Select Started Date",
    onConfirm,
    onCancel: jest.fn(),
    initialDate: new Date(2026, 0, 1),
  };
  const result = await render(<DatePickerModal {...props} />);
  const selected = new Date(2026, 0, 10);
  await act(() => result.getByTestId("date-picker").props.onChange({}, selected));
  await result.rerender(<DatePickerModal {...props} initialDate={selected} isPending />);
  expect(result.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await result.rerender(<DatePickerModal {...props} error="Save rejected" />);
  expect(result.getByTestId("date-picker").props.value).toEqual(selected);
  expect(result.getByRole("alert")).toHaveTextContent("Save rejected");
  await fireEvent.press(result.getByRole("button", { name: "Confirm" }));
  expect(onConfirm).toHaveBeenLastCalledWith(selected);
  await result.rerender(<DatePickerModal {...props} visible={false} />);
  await result.rerender(<DatePickerModal {...props} />);
  expect(result.getByTestId("date-picker").props.value).toEqual(props.initialDate);
});
