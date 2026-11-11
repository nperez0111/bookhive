import { act, fireEvent, render } from "@testing-library/react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { DatePickerModal } from "../DatePickerModal";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: jest.fn(() => "dark") }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: (props: object) => <View {...props} /> };
});

it("preserves the selected date across optimistic canonical changes and a failed save", () => {
  const onConfirm = jest.fn();
  const props = {
    visible: true,
    title: "Select Started Date",
    onConfirm,
    onCancel: jest.fn(),
    initialDate: new Date(2026, 0, 1),
  };
  const result = render(<DatePickerModal {...props} />);
  const selected = new Date(2026, 0, 10);
  act(() => result.UNSAFE_getByType(DateTimePicker).props.onChange({}, selected));
  result.rerender(<DatePickerModal {...props} initialDate={selected} isPending />);
  expect(result.getByRole("button", { name: "Saving…" })).toBeDisabled();
  result.rerender(<DatePickerModal {...props} error="Save rejected" />);
  expect(result.UNSAFE_getByType(DateTimePicker).props.value).toEqual(selected);
  expect(result.getByRole("alert")).toHaveTextContent("Save rejected");
  fireEvent.press(result.getByRole("button", { name: "Confirm" }));
  expect(onConfirm).toHaveBeenLastCalledWith(selected);
  result.rerender(<DatePickerModal {...props} visible={false} />);
  result.rerender(<DatePickerModal {...props} />);
  expect(result.UNSAFE_getByType(DateTimePicker).props.value).toEqual(props.initialDate);
});
