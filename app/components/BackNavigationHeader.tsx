import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { HeaderAction } from "./HeaderAction";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ThemedText } from "./ThemedText";
import { useRouter } from "expo-router";
import { Colors } from "@/constants/Colors";
import { useAdaptiveLayout } from "@/hooks/useAdaptiveLayout";

type BackNavigationHeaderProps = {
  title?: string;
  subtitle?: string;
  centered?: boolean;
  onBackPress?: () => void;
  rightElement?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function BackNavigationHeader({
  title,
  subtitle,
  centered = false,
  onBackPress,
  rightElement,
  style,
}: BackNavigationHeaderProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const router = useRouter();
  const { page } = useAdaptiveLayout();

  const handleBackPress = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      if (router.canGoBack()) router.back();
      else router.navigate("/");
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: 8,
          paddingBottom: 8,
          backgroundColor: colors.background,
          borderBottomColor: colors.cardBorder,
        },
        style,
      ]}
    >
      <View style={[styles.content, page]}>
        <HeaderAction
          tone="neutral"
          accessibilityLabel="Back"
          onPress={handleBackPress}
          style={styles.backButton}
          pressRetentionOffset={12}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primaryText} />
        </HeaderAction>

        {title && (
          <View style={[styles.titleContainer, centered && { alignItems: "center" }]}>
            <View style={[styles.titlePill, centered && { alignItems: "center" }]}>
              <ThemedText
                accessibilityRole="header"
                style={[
                  styles.title,
                  { color: colors.primaryText },
                  centered && { textAlign: "center", fontSize: 22, lineHeight: 28 },
                ]}
                type="heading"
              >
                {title}
              </ThemedText>
              {subtitle ? (
                <ThemedText
                  type="caption"
                  style={[
                    { color: colors.secondaryText },
                    centered && { textAlign: "center", fontSize: 15, lineHeight: 21 },
                  ]}
                >
                  {subtitle}
                </ThemedText>
              ) : null}
            </View>
          </View>
        )}

        {rightElement ? <View style={styles.rightContainer}>{rightElement}</View> : null}
        {centered && !rightElement ? <View style={{ width: 52 }} accessible={false} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 1000,
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  content: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    zIndex: 10,
  },
  titleContainer: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
  },
  titlePill: {
    flexShrink: 1,
    overflow: "hidden",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  rightContainer: {
    minWidth: 44,
    maxWidth: "100%",
    marginLeft: "auto",
    alignItems: "flex-end",
  },
});
