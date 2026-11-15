import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { ThemedText } from "./ThemedText";

type SectionHeaderProps = {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({ icon, title, subtitle, right, style }: SectionHeaderProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  return (
    <View style={[styles.container, style]}>
      <View style={styles.leftGroup}>
        {icon ? <Ionicons name={icon} size={18} color={colors.primary} accessible={false} /> : null}
        <View style={styles.texts}>
          <ThemedText style={{ color: colors.primaryText }} type="heading">
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]} type="caption">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {right}
    </View>
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
  texts: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
});
