import React from "react";
import { ViewStyle, TextStyle } from "react-native";
import { MotionPressable } from "./motion/MotionPressable";
import { ThemedText } from "./ThemedText";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Colors } from "@/constants/Colors";

export type ThemedButtonProps = {
  title: string;
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "small" | "medium" | "large";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  static?: boolean;
};

export function ThemedButton({
  title,
  accessibilityLabel,
  onPress,
  variant = "primary",
  size = "medium",
  disabled = false,
  loading = false,
  style,
  textStyle,
  leftIcon,
  rightIcon,
  static: isStatic,
}: ThemedButtonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const getButtonStyle = (pressed?: boolean): ViewStyle => {
    const baseStyle: ViewStyle = {
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      minHeight: 44,
    };

    // Size styles
    switch (size) {
      case "small":
        baseStyle.paddingVertical = 8;
        baseStyle.paddingHorizontal = 16;
        break;
      case "large":
        baseStyle.paddingVertical = 16;
        baseStyle.paddingHorizontal = 32;
        break;
      default: // medium
        baseStyle.paddingVertical = 12;
        baseStyle.paddingHorizontal = 24;
    }

    // Variant styles
    switch (variant) {
      case "primary":
        baseStyle.backgroundColor = pressed ? colors.primaryLight : colors.primary;
        baseStyle.shadowColor = colors.shadowLight as any;
        baseStyle.shadowOffset = { width: 0, height: 2 } as any;
        baseStyle.shadowOpacity = 0.2 as any;
        baseStyle.shadowRadius = 6 as any;
        baseStyle.elevation = 3 as any;
        break;
      case "secondary":
        baseStyle.backgroundColor = pressed ? colors.activeBackground : colors.buttonBackground;
        baseStyle.borderWidth = 1;
        baseStyle.borderColor = colors.buttonBorder;
        break;
      case "outline":
        baseStyle.backgroundColor = pressed ? colors.background : "transparent";
        baseStyle.borderWidth = 2;
        baseStyle.borderColor = colors.primary;
        break;
      case "ghost":
        baseStyle.backgroundColor = pressed ? colors.background : "transparent";
        break;
    }

    // Disabled state
    if (disabled) {
      baseStyle.opacity = 0.5;
    }

    return baseStyle;
  };

  const getTextStyle = (): TextStyle => {
    const baseStyle: TextStyle = {
      fontWeight: "600",
    };

    // Size styles
    switch (size) {
      case "small":
        baseStyle.fontSize = 14;
        break;
      case "large":
        baseStyle.fontSize = 18;
        break;
      default: // medium
        baseStyle.fontSize = 16;
    }

    // Variant styles
    switch (variant) {
      case "primary":
        baseStyle.color = Colors.light.primaryText;
        break;
      case "secondary":
        baseStyle.color = colors.primaryText;
        break;
      case "outline":
        baseStyle.color = colors.accentForeground;
        break;
      case "ghost":
        baseStyle.color = colors.accentForeground;
        break;
    }

    return baseStyle;
  };

  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[getButtonStyle(), style]}
      pressedStyle={{ backgroundColor: getButtonStyle(true).backgroundColor }}
      static={isStatic}
      onPress={onPress}
      disabled={disabled || loading}
      android_ripple={{
        color: Colors[colorScheme ?? "light"].pressedBackground as any,
      }}
    >
      {leftIcon}
      <ThemedText style={[getTextStyle(), textStyle]}>{loading ? "Loading..." : title}</ThemedText>
      {rightIcon}
    </MotionPressable>
  );
}
