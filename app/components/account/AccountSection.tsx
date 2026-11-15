import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { ThemedText } from "@/components/ThemedText";

export function AccountSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  return (
    <View style={[styles.card, { borderColor: colors.cardBorder }]}>
      <ThemedText type="heading">{title}</ThemedText>
      <ThemedText type="body" style={{ color: colors.secondaryText }}>
        {description}
      </ThemedText>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { gap: 12 },
});
