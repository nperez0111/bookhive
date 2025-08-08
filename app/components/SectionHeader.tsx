import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { ThemedText } from "./ThemedText";

type SectionHeaderProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: any;
};

export function SectionHeader({
  icon,
  title,
  subtitle,
  right,
  style,
}: SectionHeaderProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  return (
    <LinearGradient
      colors={
        colorScheme === "dark"
          ? ["rgba(255,255,255,0.02)", "rgba(255,255,255,0)"]
          : ["rgba(0,0,0,0.03)", "rgba(0,0,0,0)"]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.container, style]}
    >
      <View style={styles.leftGroup}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.activeBackground },
          ]}
        >
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <View style={styles.texts}>
          <ThemedText
            style={[styles.title, { color: colors.primaryText }]}
            type="heading"
          >
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText
              style={[styles.subtitle, { color: colors.secondaryText }]}
              type="caption"
            >
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {right}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 12,
  },
  leftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  texts: {
    flex: 1,
  },
  title: {},
  subtitle: {
    marginTop: 2,
  },
});
