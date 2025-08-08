import React from "react";
import { Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { FadeInImage } from "@/components/FadeInImage";

export type BookCardProps = {
  title: string;
  authors: string;
  imageUri: string;
  onPress?: () => void;
  orientation?: "vertical" | "horizontal"; // vertical = image left, text right; horizontal = image on top
  style?: ViewStyle;
};

export function BookCard({
  title,
  authors,
  imageUri,
  onPress,
  orientation = "horizontal",
  style,
}: BookCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const isHorizontal = orientation === "horizontal";
  const horizontalDefaultWidth = 180;
  const horizontalInfoMinHeight = 60; // tighter baseline while keeping 2-line title + 1-line author

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.container,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.cardBorder,
          shadowColor: colors.shadowLight,
          flexDirection: isHorizontal ? "column" : "row",
          alignItems: isHorizontal ? "center" : "flex-start",
          width:
            isHorizontal && !style?.width ? horizontalDefaultWidth : undefined,
          paddingBottom: isHorizontal ? 10 : 8,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.coverWrap,
          isHorizontal ? styles.coverTop : styles.coverLeft,
        ]}
      >
        <FadeInImage
          source={{ uri: imageUri }}
          style={isHorizontal ? styles.cover : styles.coverSmall}
          resizeMode="cover"
        />
      </View>
      <View
        style={[
          styles.info,
          isHorizontal
            ? { paddingTop: 8, minHeight: horizontalInfoMinHeight }
            : { paddingLeft: 12, flex: 1 },
        ]}
      >
        <ThemedText
          style={[styles.title, { color: colors.primaryText }]}
          numberOfLines={2}
          type="label"
        >
          {title}
        </ThemedText>
        <ThemedText
          style={[styles.author, { color: colors.secondaryText }]}
          numberOfLines={1}
          type="caption"
        >
          {authors}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  coverWrap: {
    overflow: "hidden",
    borderRadius: 12,
  },
  coverTop: {
    margin: 10,
    marginBottom: 6,
    alignSelf: "center",
  },
  coverLeft: {
    margin: 8,
    marginRight: 0,
  },
  cover: {
    width: 120,
    height: 180,
    borderRadius: 8,
  },
  coverSmall: {
    width: 72,
    height: 108,
    borderRadius: 8,
  },
  info: {
    paddingHorizontal: 10,
  },
  title: {
    marginBottom: 2,
  },
  author: {},
});
