import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

type StatsCardProps = {
  items: Array<{ label: string; value: string | number }>; // exactly 3 looks best
  style?: any;
  onItemPress?: (label: string) => void;
};

export function StatsCard({ items, style, onItemPress }: StatsCardProps) {
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
          <Pressable
            style={({ pressed }) => [
              styles.item,
              onItemPress && pressed && styles.itemPressed,
            ]}
            onPress={() => onItemPress?.(it.label)}
            disabled={!onItemPress}
          >
            <ThemedText type="title" style={{ color: colors.primary }}>
              {it.value}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.secondaryText }}>
              {it.label}
            </ThemedText>
          </Pressable>
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
  itemPressed: {
    opacity: 0.6,
  },
  divider: {
    width: 1,
    height: 40,
  },
});
