import React, { useCallback } from "react";
import { Animated, Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";
import { FadeInImage } from "@/components/FadeInImage";

const PRESS_SCALE = 0.96;

function useScalePress() {
  const scale = React.useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: PRESS_SCALE,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  }, [scale]);

  const onPressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  }, [scale]);

  return { scale, onPressIn, onPressOut };
}

export type BookCardVariant = "dense" | "list" | "row";

export type BookCardProps = {
  title: string;
  authors: string;
  imageUri: string;
  onPress?: () => void;
  /** Card variant: dense (cover grid), list (cover + children slot), row (horizontal) */
  variant?: BookCardVariant;
  /** @deprecated Use variant instead. "horizontal" → "dense", "vertical" → "row" */
  orientation?: "vertical" | "horizontal";
  style?: ViewStyle;
  /** Optional extra line of metadata to show under authors, e.g., "@handle" */
  meta?: string;
  /** Children rendered below the cover in "list" variant */
  children?: React.ReactNode;
  /** Row variant size */
  rowSize?: "compact" | "small" | "medium";
};

function resolveVariant(
  variant?: BookCardVariant,
  orientation?: "vertical" | "horizontal",
): BookCardVariant {
  if (variant) return variant;
  if (orientation === "vertical") return "row";
  return "dense";
}

const ROW_SIZES = {
  compact: { cover: { width: 48, height: 72 }, gap: 8 },
  small: { cover: { width: 60, height: 90 }, gap: 10 },
  medium: { cover: { width: 72, height: 108 }, gap: 12 },
} as const;

/** Inset outline overlay that gives book covers consistent edge definition against any background. */
function CoverOutline({ borderRadius }: { borderRadius: number }) {
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.08)",
        },
      ]}
      pointerEvents="none"
    />
  );
}

export function BookCard({
  title,
  authors,
  imageUri,
  onPress,
  variant: variantProp,
  orientation,
  style,
  meta,
  children,
  rowSize = "medium",
}: BookCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const variant = resolveVariant(variantProp, orientation);
  const { scale, onPressIn, onPressOut } = useScalePress();

  if (variant === "dense") {
    return (
      <Animated.View style={[styles.denseContainer, { transform: [{ scale }] }, style]}>
        <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
          <View style={styles.denseCoverWrap}>
            <FadeInImage source={{ uri: imageUri }} style={styles.denseCover} resizeMode="cover" />
            <CoverOutline borderRadius={12} />
          </View>
          <View style={styles.denseInfo}>
            <ThemedText
              style={[styles.title, { color: colors.primaryText }]}
              numberOfLines={2}
              type="label"
            >
              {title}
            </ThemedText>
            <ThemedText style={{ color: colors.secondaryText }} numberOfLines={1} type="caption">
              {authors}
            </ThemedText>
          </View>
        </Pressable>
      </Animated.View>
    );
  }

  if (variant === "list") {
    return (
      <Animated.View style={[styles.listContainer, { transform: [{ scale }] }, style]}>
        <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
          <View style={styles.denseCoverWrap}>
            <FadeInImage source={{ uri: imageUri }} style={styles.denseCover} resizeMode="cover" />
            <CoverOutline borderRadius={12} />
          </View>
          {children && <View style={styles.listChildren}>{children}</View>}
        </Pressable>
      </Animated.View>
    );
  }

  // variant === "row"
  const rowConfig = ROW_SIZES[rowSize];
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          styles.rowContainer,
          {
            backgroundColor: colors.cardBackground,
            shadowColor: colors.shadowMedium,
            gap: rowConfig.gap,
          },
        ]}
      >
        <View style={styles.rowCoverWrap}>
          <FadeInImage
            source={{ uri: imageUri }}
            style={[styles.rowCover, rowConfig.cover]}
            resizeMode="cover"
          />
          <CoverOutline borderRadius={8} />
        </View>
        <View style={styles.rowInfo}>
          <ThemedText
            style={[styles.title, { color: colors.primaryText }]}
            numberOfLines={2}
            type="label"
          >
            {title}
          </ThemedText>
          <ThemedText style={{ color: colors.secondaryText }} numberOfLines={1} type="caption">
            {authors}
          </ThemedText>
          {meta ? (
            <ThemedText
              style={{ color: colors.tertiaryText, marginTop: 2 }}
              numberOfLines={1}
              type="caption"
            >
              {meta}
            </ThemedText>
          ) : null}
          {children}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Dense variant (grid card)
  denseContainer: {
    flex: 1,
  },
  denseCoverWrap: {
    aspectRatio: 2 / 3,
    borderRadius: 12,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  denseCover: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  denseInfo: {
    paddingTop: 8,
    paddingHorizontal: 2,
  },

  // List variant (cover + children below)
  listContainer: {
    flex: 1,
  },
  listChildren: {
    paddingTop: 8,
  },

  // Row variant (horizontal card)
  rowContainer: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  rowCoverWrap: {
    borderRadius: 8,
    overflow: "hidden",
  },
  rowCover: {
    borderRadius: 8,
  },
  rowInfo: {
    flex: 1,
    justifyContent: "center",
  },
  title: {
    marginBottom: 2,
  },
});
