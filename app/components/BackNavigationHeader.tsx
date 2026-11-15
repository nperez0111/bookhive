import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { HeaderAction } from "./HeaderAction";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ThemedText } from "./ThemedText";
import { useRouter } from "expo-router";
import { Colors } from "@/constants/Colors";

type BackNavigationHeaderProps = {
  title?: string;
  onBackPress?: () => void;
  rightElement?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function BackNavigationHeader({
  title,
  onBackPress,
  rightElement,
  style,
}: BackNavigationHeaderProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const router = useRouter();

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
      <View style={styles.content}>
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
          <View style={styles.titleContainer}>
            <View style={styles.titlePill}>
              <ThemedText
                accessibilityRole="header"
                style={[styles.title, { color: colors.primaryText }]}
                type="heading"
              >
                {title}
              </ThemedText>
            </View>
          </View>
        )}

        {rightElement ? <View style={styles.rightContainer}>{rightElement}</View> : null}
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
