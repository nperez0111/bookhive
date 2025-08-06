/**
 * Enhanced color scheme for BookHive with beautiful gradients and sophisticated colors
 * The colors are designed to create a warm, inviting reading experience
 */

const tintColorLight = "#d08700";
const tintColorDark = "#fbbf24";

export const Colors = {
  light: {
    text: "#1a1a1a",
    background: "#ffffff",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,

    // Enhanced card and UI colors
    cardBackground: "rgba(255, 255, 255, 0.95)",
    cardBorder: "rgba(208, 135, 0, 0.15)",
    buttonBackground: "rgba(208, 135, 0, 0.08)",
    buttonBorder: "rgba(208, 135, 0, 0.2)",

    // Enhanced text colors with better hierarchy
    primaryText: "#1a1a1a",
    secondaryText: "#4a5568",
    tertiaryText: "#718096",
    placeholderText: "#a0aec0",

    // Beautiful accent colors
    primary: "#d08700",
    primaryLight: "#f0b100",
    primaryDark: "#b77900",
    primaryGradient: ["#d08700", "#f0b100"],

    // Additional accent colors
    success: "#10b981",
    successLight: "#34d399",
    error: "#ef4444",
    errorLight: "#f87171",
    warning: "#f59e0b",
    warningLight: "#fbbf24",

    // Interactive states with better feedback
    activeBackground: "rgba(208, 135, 0, 0.12)",
    inactiveBackground: "rgba(0, 0, 0, 0.04)",
    pressedBackground: "rgba(208, 135, 0, 0.2)",

    // Surface colors
    surfacePrimary: "#ffffff",
    surfaceSecondary: "#f7fafc",
    surfaceTertiary: "#edf2f7",

    // Shadow colors
    shadowLight: "rgba(0, 0, 0, 0.08)",
    shadowMedium: "rgba(0, 0, 0, 0.12)",
  },
  dark: {
    text: "#f7fafc",
    background: "#0f1419",
    tint: tintColorDark,
    icon: "#9ba1a6",
    tabIconDefault: "#9ba1a6",
    tabIconSelected: tintColorDark,

    // Enhanced card and UI colors for dark mode
    cardBackground: "rgba(255, 255, 255, 0.08)",
    cardBorder: "rgba(251, 191, 36, 0.2)",
    buttonBackground: "rgba(251, 191, 36, 0.1)",
    buttonBorder: "rgba(251, 191, 36, 0.25)",

    // Enhanced text colors for dark mode
    primaryText: "#f7fafc",
    secondaryText: "#cbd5e0",
    tertiaryText: "#a0aec0",
    placeholderText: "#718096",

    // Beautiful accent colors for dark mode
    primary: "#fbbf24",
    primaryLight: "#fcd34d",
    primaryDark: "#f59e0b",
    primaryGradient: ["#fbbf24", "#fcd34d"],

    // Additional accent colors
    success: "#10b981",
    successLight: "#34d399",
    error: "#ef4444",
    errorLight: "#f87171",
    warning: "#f59e0b",
    warningLight: "#fbbf24",

    // Interactive states for dark mode
    activeBackground: "rgba(251, 191, 36, 0.15)",
    inactiveBackground: "rgba(255, 255, 255, 0.06)",
    pressedBackground: "rgba(251, 191, 36, 0.25)",

    // Surface colors for dark mode
    surfacePrimary: "#1a202c",
    surfaceSecondary: "#2d3748",
    surfaceTertiary: "#4a5568",

    // Shadow colors for dark mode
    shadowLight: "rgba(0, 0, 0, 0.3)",
    shadowMedium: "rgba(0, 0, 0, 0.4)",
  },
};
