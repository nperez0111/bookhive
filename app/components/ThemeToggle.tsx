import React from "react";
import { View, Switch, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { useTheme } from "@/context/theme";
import { Colors } from "@/constants/Colors";

interface ThemeToggleProps {
  style?: any;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ style }) => {
  const { theme, themeMode, setThemeMode, isDark } = useTheme();
  const colors = Colors[theme];

  const handleToggle = () => {
    const newMode = isDark ? "light" : "dark";
    setThemeMode(newMode);
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.settingLeft}>
        <Ionicons
          name={isDark ? "moon" : "sunny"}
          size={20}
          color={colors.secondaryText}
        />
        <ThemedText
          style={[styles.settingText, { color: colors.primaryText }]}
          type="body"
        >
          Dark Mode
        </ThemedText>
      </View>
      <View style={styles.switchContainer}>
        <Switch
          value={isDark}
          onValueChange={handleToggle}
          trackColor={{
            false: colors.inactiveBackground,
            true: colors.activeBackground,
          }}
          thumbColor={isDark ? colors.primary : colors.tertiaryText}
          ios_backgroundColor={colors.inactiveBackground}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    overflow: "hidden",
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  settingText: {
    flex: 1,
  },
  switchContainer: {
    marginRight: 8,
  },
});
