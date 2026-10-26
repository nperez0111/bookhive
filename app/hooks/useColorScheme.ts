import { useTheme } from "@/context/theme";

export function useColorScheme(): "light" | "dark" {
  const { theme } = useTheme();
  return theme;
}
