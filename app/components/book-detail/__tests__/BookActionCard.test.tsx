import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BookActionCard } from "../../BookActionCard";
import { DatePickerModal } from "../../DatePickerModal";

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("../../DatePickerModal", () => ({ DatePickerModal: () => null }));

function picker(title: string) {
  return screen.UNSAFE_getAllByType(DatePickerModal).find((node) => node.props.title === title)!;
}

it("validates reading date order before calling the write adapter", async () => {
  const onStartedAtChange = jest.fn().mockResolvedValue(true);
  const onFinishedAtChange = jest.fn().mockResolvedValue(true);
  render(
    <BookActionCard
      type="dates"
      title="Reading dates"
      icon="calendar-outline"
      startedAt="2026-01-10T00:00:00Z"
      finishedAt="2026-01-20T00:00:00Z"
      onStartedAtChange={onStartedAtChange}
      onFinishedAtChange={onFinishedAtChange}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "Edit reading dates" }));
  fireEvent.press(screen.getByRole("button", { name: "Change started date" }));
  await act(async () => picker("Select Started Date").props.onConfirm(new Date(2026, 0, 21)));
  expect(onStartedAtChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Finished date must be on or after started date",
  );
  fireEvent.press(screen.getByRole("button", { name: "Change finished date" }));
  await act(async () => picker("Select Finished Date").props.onConfirm(new Date(2026, 0, 9)));
  expect(onFinishedAtChange).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Change finished date" }));
  await act(async () => picker("Select Finished Date").props.onConfirm(new Date(2026, 0, 10)));
  expect(onFinishedAtChange).toHaveBeenCalledWith("2026-01-10");
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["Started", "Finished"])(
  "awaits %s date success and keeps a failed selection open for retry",
  async (field) => {
    let finish!: (saved: boolean) => void;
    const save = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <BookActionCard
        type="dates"
        title="Reading dates"
        icon="calendar-outline"
        onStartedAtChange={save}
        onFinishedAtChange={save}
      />,
    );
    fireEvent.press(screen.getByLabelText("Edit reading dates"));
    fireEvent.press(screen.getByLabelText(`Change ${field.toLowerCase()} date`));
    const title = `Select ${field} Date`;
    act(() => {
      void picker(title).props.onConfirm(new Date(2026, 0, 10));
    });
    expect(picker(title).props.visible).toBe(true);
    expect(picker(title).props.isPending).toBe(true);
    act(() => {
      void picker(title).props.onConfirm(new Date(2026, 0, 11));
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish(false));
    expect(picker(title).props.visible).toBe(true);
    expect(picker(title).props.error).toContain("Could not save this date");
    act(() => {
      void picker(title).props.onConfirm(new Date(2026, 0, 10));
    });
    expect(save).toHaveBeenLastCalledWith("2026-01-10");
    await act(async () => finish(true));
    expect(picker(title).props.visible).toBe(false);
  },
);

it("hides an open date picker and blocks its confirmation while a write is pending", async () => {
  const onStartedAtChange = jest.fn();
  const props = {
    type: "dates" as const,
    title: "Reading dates",
    icon: "calendar-outline" as const,
    onStartedAtChange,
    onFinishedAtChange: jest.fn(),
  };
  const { rerender } = render(<BookActionCard {...props} />);
  fireEvent.press(screen.getByRole("button", { name: "Edit reading dates" }));
  fireEvent.press(screen.getByRole("button", { name: "Change started date" }));
  expect(picker("Select Started Date").props.visible).toBe(true);
  rerender(<BookActionCard {...props} isPending />);
  expect(picker("Select Started Date").props.visible).toBe(false);
  await act(async () => picker("Select Started Date").props.onConfirm(new Date(2026, 0, 10)));
  expect(onStartedAtChange).not.toHaveBeenCalled();
});

it("keeps the date picker open and shows a rejected adapter's error", async () => {
  render(
    <BookActionCard
      type="dates"
      title="Reading dates"
      icon="calendar-outline"
      onStartedAtChange={jest.fn().mockRejectedValue(new Error("Date rejected"))}
      onFinishedAtChange={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByLabelText("Edit reading dates"));
  fireEvent.press(screen.getByLabelText("Change started date"));
  await act(async () => picker("Select Started Date").props.onConfirm(new Date(2026, 0, 10)));
  expect(picker("Select Started Date").props.visible).toBe(true);
  expect(picker("Select Started Date").props.error).toBe("Date rejected");
});
