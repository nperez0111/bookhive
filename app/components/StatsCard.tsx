import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

type StatsCardProps = {
  items: Array<{ label: string; value: string | number }>; // exactly 3 looks best
  style?: any;
};

export function StatsCard({ items, style }: StatsCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.cardBorder,
          shadowColor: colors.shadowLight,
        },
        style,
      ]}
    >
      {items.map((it, idx) => (
        <React.Fragment key={idx}>
          <View style={styles.item}>
            <ThemedText type="title" style={{ color: colors.primary }}>
              {it.value}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.secondaryText }}>
              {it.label}
            </ThemedText>
          </View>
          {idx < items.length - 1 ? (
            <View
              style={[styles.divider, { backgroundColor: colors.cardBorder }]}
            />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  item: {
    alignItems: "center",
    paddingHorizontal: 10,
  },
  divider: {
    width: 1,
    height: 40,
  },
});
