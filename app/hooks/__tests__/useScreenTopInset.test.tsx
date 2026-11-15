import { renderHook } from "@testing-library/react-native";
import { Platform } from "react-native";
import { useScreenTopInset } from "../useScreenTopInset";

let mockTopInset = 59;
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: mockTopInset }),
}));

beforeEach(() => {
  mockTopInset = 59;
});
afterEach(() => jest.restoreAllMocks());

it("does not reserve the status bar twice on iOS", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  expect((await renderHook(() => useScreenTopInset())).result.current).toBe(0);
});

it("updates Android screen padding when rotation changes the device inset", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  const { result, rerender } = await renderHook(() => useScreenTopInset());
  expect(result.current).toBe(59);
  mockTopInset = 0;
  await rerender({});
  expect(result.current).toBe(0);
});

it("preserves browser safe-area padding because the root only pads iOS", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  expect((await renderHook(() => useScreenTopInset())).result.current).toBe(59);
});
