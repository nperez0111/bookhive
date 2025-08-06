import { useColorScheme as useRNColorScheme } from "react-native";
import { useTheme } from "@/context/theme";

export function useColorScheme() {
  try {
    const { theme } = useTheme();
    return theme;
  } catch (error) {
    // Fallback to React Native's useColorScheme if theme context is not available
    return useRNColorScheme();
  }
}
