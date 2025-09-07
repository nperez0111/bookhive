import React from "react";
import { View, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { ThemedText } from "./ThemedText";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type BackNavigationHeaderProps = {
  title?: string;
  onBackPress?: () => void;
  rightElement?: React.ReactNode;
  style?: any;
};

export function BackNavigationHeader({
  title,
  onBackPress,
  rightElement,
  style,
}: BackNavigationHeaderProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const { top } = useSafeAreaInsets();

  const handleBackPress = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      router.back();
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Platform.OS === "ios" ? top : top + 8,
          backgroundColor: colors.background,
          borderBottomColor: colors.cardBorder,
        },
        style,
      ]}
    >
      <View style={styles.content}>
        <Pressable
          onPress={handleBackPress}
          style={[
            styles.backButton,
            {
              backgroundColor:
                colorScheme === "dark"
                  ? "rgba(255, 255, 255, 0.1)"
                  : "rgba(0, 0, 0, 0.05)",
            },
          ]}
          hitSlop={8}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color={colors.primaryText}
          />
        </Pressable>

        {title && (
          <ThemedText
            style={[styles.title, { color: colors.primaryText }]}
            type="heading"
            numberOfLines={1}
          >
            {title}
          </ThemedText>
        )}

        <View style={styles.rightContainer}>{rightElement}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingBottom: 12,
    zIndex: 1000,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    height: 44,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
  },
  rightContainer: {
    minWidth: 40,
    alignItems: "flex-end",
  },
});