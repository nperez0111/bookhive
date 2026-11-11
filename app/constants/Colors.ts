/** BookHive's brown and eggshell surfaces, with orange/yellow actions. */
const tintColorLight = "#eb9109";
const tintColorDark = "#f59e0b"; // amber-500

export const Colors = {
  light: {
    text: "#1c1917", // stone-900
    background: "#f9eabc",
    tint: tintColorLight,
    icon: "#78613a",
    tabIconDefault: "#78613a",
    tabIconSelected: tintColorLight,

    // Card and UI colors (warm, book-like)
    cardBackground: "#fff2cf",
    cardBorder: "#d9c592",
    buttonBackground: "rgba(235, 145, 9, 0.08)",
    buttonBorder: "rgba(235, 145, 9, 0.2)",

    // Text hierarchy
    primaryText: "#1c1917", // stone-900
    secondaryText: "#695332",
    tertiaryText: "#78613a",
    placeholderText: "#78613a",

    // Accent colors aligned to web
    primary: "#eb9109",
    accentForeground: "#1c1917", // Readable text/glyphs on unfilled accent controls
    primaryLight: "#fbbf24", // amber-400 (--accent)
    primaryDark: "#92400e", // amber-800 (--secondary)
    primaryGradient: ["#eb9109", "#f59e0b"],

    // Status colors
    success: "#10b981",
    successLight: "#34d399",
    error: "#dc2626", // red-600
    errorLight: "#f87171",
    errorText: "#b91c1c", // Small error copy on eggshell surfaces
    warning: "#f59e0b",
    warningLight: "#fbbf24",

    // Interactive states
    activeBackground: "rgba(235, 145, 9, 0.12)",
    inactiveBackground: "rgba(0, 0, 0, 0.04)",
    pressedBackground: "rgba(235, 145, 9, 0.2)",

    // Surface layers (warm tones)
    surfacePrimary: "#fff2cf",
    surfaceSecondary: "#f2dfac",
    surfaceTertiary: "#e8d29a",

    // Shadow colors
    shadowLight: "rgba(0, 0, 0, 0.08)",
    shadowMedium: "rgba(0, 0, 0, 0.12)",
  },
  dark: {
    text: "#fafaf9", // stone-50
    background: "#3f2b08",
    tint: tintColorDark,
    icon: "#d5bf95",
    tabIconDefault: "#d5bf95",
    tabIconSelected: tintColorDark,

    // Card and UI colors for dark mode
    cardBackground: "#4d3510",
    cardBorder: "#735322",
    buttonBackground: "rgba(245, 158, 11, 0.1)",
    buttonBorder: "rgba(245, 158, 11, 0.25)",

    // Text hierarchy for dark mode
    primaryText: "#fafaf9", // stone-50
    secondaryText: "#d5bf95",
    tertiaryText: "#c4ac80",
    placeholderText: "#c4ac80",

    // Accent colors for dark mode
    primary: "#f59e0b", // amber-500 (--primary dark)
    accentForeground: "#f59e0b",
    primaryLight: "#fcd34d", // amber-300
    primaryDark: "#d97706", // amber-600
    primaryGradient: ["#f59e0b", "#fbbf24"],

    // Status colors
    success: "#10b981",
    successLight: "#34d399",
    error: "#ef4444",
    errorLight: "#f87171",
    errorText: "#f87171",
    warning: "#f59e0b",
    warningLight: "#fbbf24",

    // Interactive states for dark mode
    activeBackground: "rgba(245, 158, 11, 0.15)",
    inactiveBackground: "rgba(255, 255, 255, 0.06)",
    pressedBackground: "rgba(245, 158, 11, 0.25)",

    // Surface layers for dark mode
    surfacePrimary: "#4d3510",
    surfaceSecondary: "#594019",
    surfaceTertiary: "#674b20",

    // Shadow colors for dark mode
    shadowLight: "rgba(0, 0, 0, 0.3)",
    shadowMedium: "rgba(0, 0, 0, 0.4)",
  },
};
