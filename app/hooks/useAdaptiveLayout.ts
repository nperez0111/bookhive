import { useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";

/** Use the available window, not the device model, so Split View stays usable. */
export function useAdaptiveLayout() {
  const { width, fontScale } = useWindowDimensions();
  const wide = width >= 768 && fontScale < 1.6;
  const pageWidth = width >= 768 ? Math.min(width - 64, 1160) : width;
  const page: ViewStyle = { width: "100%", maxWidth: pageWidth, alignSelf: "center" };
  const reading: ViewStyle = { ...page, maxWidth: Math.min(pageWidth, 760) };
  const coverColumns = Math.max(2, Math.floor((pageWidth - 40) / (160 * Math.max(1, fontScale))));
  return { wide, page, reading, pageWidth, coverColumns };
}
