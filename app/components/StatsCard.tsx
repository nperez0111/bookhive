import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { MotionPressable } from "./motion/MotionPressable";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

type StatsCardProps = {
  items: { label: string; value: string | number }[]; // exactly 3 looks best
  style?: StyleProp<ViewStyle>;
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
          <MotionPressable
            accessibilityRole={onItemPress ? "button" : undefined}
            accessibilityLabel={`${it.value} ${it.label}`}
            style={styles.item}
            pressedStyle={styles.itemPressed}
            onPress={() => onItemPress?.(it.label)}
            disabled={!onItemPress}
          >
            <ThemedText
              type="heading"
              style={{ color: colors.primaryText, fontVariant: ["tabular-nums"] }}
            >
              {it.value}
            </ThemedText>
            <ThemedText type="caption" style={{ color: colors.secondaryText, textAlign: "center" }}>
              {it.label}
            </ThemedText>
          </MotionPressable>
          {idx < items.length - 1 ? (
            <View style={[styles.divider, { backgroundColor: colors.cardBorder }]} />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  item: {
    flex: 1,
    minHeight: 44,
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
