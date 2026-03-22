import React from "react";
import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { FadeInImage } from "@/components/FadeInImage";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { Ionicons } from "@expo/vector-icons";

type UserBlockSize = "sm" | "md" | "lg";

interface UserBlockProps {
  handle: string;
  displayName?: string;
  avatar?: string;
  size?: UserBlockSize;
  onPress?: () => void;
  style?: ViewStyle;
  /** Optional suffix text, e.g. "finished reading 2 days ago" */
  suffix?: string;
}

const SIZE_CONFIG = {
  sm: { avatar: 28, fontSize: 11, gap: 6 },
  md: { avatar: 36, fontSize: 13, gap: 8 },
  lg: { avatar: 56, fontSize: 15, gap: 12 },
} as const;

export function UserBlock({
  handle,
  displayName,
  avatar,
  size = "md",
  onPress,
  style,
  suffix,
}: UserBlockProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const config = SIZE_CONFIG[size];

  const content = (
    <View style={[styles.container, { gap: config.gap }, style]}>
      {avatar ? (
        <FadeInImage
          source={{ uri: avatar }}
          style={[
            styles.avatar,
            {
              width: config.avatar,
              height: config.avatar,
              borderRadius: config.avatar / 2,
              borderColor: colors.cardBorder,
            },
          ]}
        />
      ) : (
        <View
          style={[
            styles.avatarPlaceholder,
            {
              width: config.avatar,
              height: config.avatar,
              borderRadius: config.avatar / 2,
              backgroundColor: colors.inactiveBackground,
            },
          ]}
        >
          <Ionicons name="person" size={config.avatar * 0.5} color={colors.tertiaryText} />
        </View>
      )}
      <View style={styles.textContainer}>
        {displayName && size !== "sm" ? (
          <ThemedText
            style={{ color: colors.primaryText, fontSize: config.fontSize }}
            numberOfLines={1}
            type="label"
          >
            {displayName}
          </ThemedText>
        ) : null}
        <ThemedText
          style={{
            color: displayName && size !== "sm" ? colors.secondaryText : colors.primaryText,
            fontSize: size === "sm" ? config.fontSize : config.fontSize - 1,
          }}
          numberOfLines={1}
          type="caption"
        >
          @{handle}
        </ThemedText>
        {suffix ? (
          <ThemedText
            style={{ color: colors.tertiaryText, fontSize: config.fontSize - 2 }}
            numberOfLines={1}
            type="caption"
          >
            {suffix}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    borderWidth: 1,
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
  },
});
