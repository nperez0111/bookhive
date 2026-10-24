import { act, renderHook } from "@testing-library/react-native";
import { useDebounce } from "../useDebounce";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("publishes only the latest value after rapid changes", () => {
  const { result, rerender } = renderHook(
    ({ value }: { value: string }) => useDebounce(value, 300),
    { initialProps: { value: "" } },
  );
  rerender({ value: "d" });
  act(() => jest.advanceTimersByTime(200));
  rerender({ value: "dune" });
  act(() => jest.advanceTimersByTime(299));
  expect(result.current).toBe("");
  act(() => jest.advanceTimersByTime(1));
  expect(result.current).toBe("dune");
});

test("removes its pending timer on unmount", () => {
  const { rerender, unmount } = renderHook(
    ({ value }: { value: string }) => useDebounce(value, 300),
    { initialProps: { value: "" } },
  );
  rerender({ value: "pending" });
  expect(jest.getTimerCount()).toBe(1);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});
