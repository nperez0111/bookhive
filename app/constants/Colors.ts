/**
 * Enhanced color scheme for BookHive with beautiful gradients and sophisticated colors
 * The colors are designed to create a warm, inviting reading experience
 */

// Aligned with web redesign CSS variables (src/index.css)
const tintColorLight = "#d97706"; // amber-600
const tintColorDark = "#f59e0b"; // amber-500

export const Colors = {
  light: {
    text: "#1c1917", // stone-900
    background: "#f9eabc", // warm sand (--background)
    tint: tintColorLight,
    icon: "#787568", // stone-500
    tabIconDefault: "#787568",
    tabIconSelected: tintColorLight,

    // Card and UI colors (warm, book-like)
    cardBackground: "#fffce8", // warm white (--card)
    cardBorder: "#e5d5a0", // sand border (--border)
    buttonBackground: "rgba(217, 119, 6, 0.08)",
    buttonBorder: "rgba(217, 119, 6, 0.2)",

    // Text hierarchy
    primaryText: "#1c1917", // stone-900
    secondaryText: "#787568", // stone-500 (--muted-foreground)
    tertiaryText: "#a8a29e", // stone-400
    placeholderText: "#d6cfc7", // stone-300

    // Accent colors aligned to web
    primary: "#d97706", // amber-600 (--primary)
    primaryLight: "#fbbf24", // amber-400 (--accent)
    primaryDark: "#92400e", // amber-800 (--secondary)
    primaryGradient: ["#d97706", "#f59e0b"],

    // Status colors
    success: "#10b981",
    successLight: "#34d399",
    error: "#dc2626", // red-600
    errorLight: "#f87171",
    warning: "#f59e0b",
    warningLight: "#fbbf24",

    // Interactive states
    activeBackground: "rgba(217, 119, 6, 0.12)", // primary/12
    inactiveBackground: "rgba(0, 0, 0, 0.04)",
    pressedBackground: "rgba(217, 119, 6, 0.2)",

    // Surface layers (warm tones)
    surfacePrimary: "#fffce8", // --card
    surfaceSecondary: "#f9eabc", // --background
    surfaceTertiary: "#ffeb99", // --muted

    // Shadow colors
    shadowLight: "rgba(0, 0, 0, 0.08)",
    shadowMedium: "rgba(0, 0, 0, 0.12)",
  },
  dark: {
    text: "#fafaf9", // stone-50
    background: "#1c0a00", // near amber-950 (--background dark)
    tint: tintColorDark,
    icon: "#fde68a", // amber-200
    tabIconDefault: "#a8a29e", // stone-400
    tabIconSelected: tintColorDark,

    // Card and UI colors for dark mode
    cardBackground: "#451a03", // amber-950 (--card dark)
    cardBorder: "#92400e", // amber-800 (--border dark)
    buttonBackground: "rgba(245, 158, 11, 0.1)",
    buttonBorder: "rgba(245, 158, 11, 0.25)",

    // Text hierarchy for dark mode
    primaryText: "#fafaf9", // stone-50
    secondaryText: "#fde68a", // amber-200 (--muted-foreground dark)
    tertiaryText: "#d6d3d1", // stone-300
    placeholderText: "#78716c", // stone-500

    // Accent colors for dark mode
    primary: "#f59e0b", // amber-500 (--primary dark)
    primaryLight: "#fcd34d", // amber-300
    primaryDark: "#d97706", // amber-600
    primaryGradient: ["#f59e0b", "#fbbf24"],

    // Status colors
    success: "#10b981",
    successLight: "#34d399",
    error: "#ef4444",
    errorLight: "#f87171",
    warning: "#f59e0b",
    warningLight: "#fbbf24",

    // Interactive states for dark mode
    activeBackground: "rgba(245, 158, 11, 0.15)",
    inactiveBackground: "rgba(255, 255, 255, 0.06)",
    pressedBackground: "rgba(245, 158, 11, 0.25)",

    // Surface layers for dark mode
    surfacePrimary: "#451a03", // amber-950
    surfaceSecondary: "#783f0f", // amber-900
    surfaceTertiary: "#92400e", // amber-800

    // Shadow colors for dark mode
    shadowLight: "rgba(0, 0, 0, 0.3)",
    shadowMedium: "rgba(0, 0, 0, 0.4)",
  },
};
