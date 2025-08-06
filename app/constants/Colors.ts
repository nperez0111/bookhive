/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const tintColorLight = "#4c3e4c";
const tintColorDark = "#ffe020";

export const Colors = {
  light: {
    text: "#11181C",
    background: "#fff",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,

    // Card and UI colors
    cardBackground: "rgba(200, 200, 3, 0.03)",
    cardBorder: "rgba(0, 0, 0, 0.15)",
    buttonBackground: "rgba(0, 0, 0, 0.05)",
    buttonBorder: "rgba(0, 0, 0, 0.15)",

    // Text colors
    primaryText: "#11181C",
    secondaryText: "#374151",
    tertiaryText: "#6B7280",
    placeholderText: "#6B7280",

    // Accent colors
    primary: "#d08700", // Darker yellow for light mode
    primaryLight: "#f0b100", // Lighter yellow for highlights
    success: "#10B981",
    error: "#EF4444",
    warning: "#F59E0B",

    // Interactive states
    activeBackground: "rgba(217, 119, 6, 0.15)", // Primary with opacity
    inactiveBackground: "rgba(0, 0, 0, 0.08)",
  },
  dark: {
    text: "#ECEDEE",
    background: "#151718",
    tint: tintColorDark,
    icon: "#9BA1A6",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,

    // Card and UI colors
    cardBackground: "rgba(255, 255, 255, 0.05)",
    cardBorder: "rgba(255, 255, 255, 0.1)",
    buttonBackground: "rgba(255, 255, 255, 0.05)",
    buttonBorder: "rgba(255, 255, 255, 0.1)",

    // Text colors
    primaryText: "#ECEDEE",
    secondaryText: "#9CA3AF",
    tertiaryText: "#9CA3AF",
    placeholderText: "#9CA3AF",

    // Accent colors
    primary: "#FBBF24", // Bright yellow for dark mode
    primaryLight: "#FBBF24", // Same as primary for dark mode
    success: "#10B981",
    error: "#EF4444",
    warning: "#F59E0B",

    // Interactive states
    activeBackground: "rgba(251, 191, 36, 0.1)", // Primary with opacity
    inactiveBackground: "rgba(255, 255, 255, 0.05)",
  },
};
