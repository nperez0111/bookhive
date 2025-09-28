import React from "react";
import { View, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { ThemedText } from "./ThemedText";
import { useRouter } from "expo-router";
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
  const router = useRouter();

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
          paddingTop: 8,
          paddingBottom: 8,
          backgroundColor: "transparent",
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
              backgroundColor: "rgba(0, 0, 0, 0.4)",
              borderWidth: 1,
              borderColor: "rgba(255, 255, 255, 0.2)",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: 4,
            },
          ]}
          hitSlop={12}
          pressRetentionOffset={12}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={colorScheme === "dark" ? "white" : "white"}
          />
        </Pressable>

        {title && (
          <View style={styles.titleContainer}>
            <ThemedText
              style={[styles.title, { color: "white" }]}
              type="heading"
              numberOfLines={1}
            >
              {title}
            </ThemedText>
          </View>
        )}

        <View style={styles.rightContainer}>{rightElement}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 1000,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 4,
    height: 36,
    position: "relative",
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    zIndex: 10,
  },
  titleContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },
  title: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    overflow: "hidden",
  },
  rightContainer: {
    minWidth: 40,
    alignItems: "flex-end",
  },
});
