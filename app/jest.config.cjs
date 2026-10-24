module.exports = {
  preset: "jest-expo",
  // Shared pure domain modules live above app/; resolve their Babel helpers
  // against the mobile workspace rather than the server's dependency graph.
  modulePaths: ["<rootDir>/node_modules"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^react$": require.resolve("react"),
    "^react/jsx-runtime$": require.resolve("react/jsx-runtime"),
    "^react/jsx-dev-runtime$": require.resolve("react/jsx-dev-runtime"),
  },
  // Bun's isolated install symlinks resolve inside node_modules/.bun/<pkg>/node_modules.
  // Match the innermost node_modules too, not only the visible workspace symlink.
  transformIgnorePatterns: [
    "node_modules/(?!\\.bun/|((jest-)?react-native|@react-native(-community)?|expo(nent)?(-[^/]+)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|standard-navigation|@sentry/react-native|native-base|react-native-svg)(/|$))",
  ],
};
