import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ThemedCard } from "@/components/ThemedCard";
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
  return (
    <ThemedCard style={styles.card}>
      <ThemedText type="heading">{title}</ThemedText>
      <ThemedText type="body">{description}</ThemedText>
      <View style={styles.actions}>{children}</View>
    </ThemedCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, gap: 12, borderRadius: 24 },
  actions: { gap: 12 },
});
