import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The root layout already reserves the iOS status-bar inset. */
export function useScreenTopInset() {
  const { top } = useSafeAreaInsets();
  return Platform.OS === "ios" ? 0 : top;
}
