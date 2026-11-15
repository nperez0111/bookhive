import { renderHook } from "@testing-library/react-native";
import { useWindowDimensions } from "react-native";
import { useAdaptiveLayout } from "../useAdaptiveLayout";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const dimensions = jest.mocked(useWindowDimensions);

it("adapts tablet columns to rotation and falls back to phone layout in a narrow window", async () => {
  dimensions.mockReturnValue({ width: 1032, height: 1376, scale: 2, fontScale: 1 });
  const { result, rerender } = await renderHook(() => useAdaptiveLayout());
  expect(result.current).toMatchObject({ wide: true, pageWidth: 968, coverColumns: 5 });
  expect(result.current.reading.maxWidth).toBe(760);

  dimensions.mockReturnValue({ width: 1376, height: 1032, scale: 2, fontScale: 1 });
  await rerender({});
  expect(result.current).toMatchObject({ wide: true, pageWidth: 1160, coverColumns: 7 });

  dimensions.mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });
  await rerender({});
  expect(result.current).toMatchObject({ wide: false, pageWidth: 402, coverColumns: 2 });
  expect(result.current.reading.maxWidth).toBe(402);
});

it("uses stacked content and fewer covers when accessibility text needs more room", async () => {
  dimensions.mockReturnValue({
    width: 1032,
    height: 1376,
    scale: 2,
    fontScale: 2,
  });
  const { result } = await renderHook(() => useAdaptiveLayout());
  expect(result.current.wide).toBe(false);
  expect(result.current.coverColumns).toBe(2);
});
