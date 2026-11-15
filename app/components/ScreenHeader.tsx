import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useAdaptiveLayout } from "@/hooks/useAdaptiveLayout";

/** Primary-tab heading. Screens own safe-area insets; actions retain their labels. */
export function ScreenHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const colors = Colors[useColorScheme() ?? "light"];
  const { page } = useAdaptiveLayout();
  return (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.background, borderBottomColor: colors.cardBorder },
      ]}
    >
      <View style={[styles.content, page]}>
        <ThemedText accessibilityRole="header" type="title" style={styles.title}>
          {title}
        </ThemedText>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    paddingTop: 8,
    paddingBottom: 12,
    minHeight: 60,
  },
  content: {
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 26, lineHeight: 34, flexShrink: 1 },
  actions: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
});
