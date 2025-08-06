import { Text, type TextProps, StyleSheet } from "react-native";

import { useThemeColor } from "@/hooks/useThemeColor";

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?:
    | "default"
    | "title"
    | "defaultSemiBold"
    | "subtitle"
    | "link"
    | "caption"
    | "heading"
    | "body"
    | "label";
  themeSource?: Parameters<typeof useThemeColor>[1];
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = "default",
  themeSource = "text",
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor(
    { light: lightColor, dark: darkColor },
    themeSource,
  );

  return (
    <Text
      style={[
        { color },
        type === "default" ? styles.default : undefined,
        type === "title" ? styles.title : undefined,
        type === "defaultSemiBold" ? styles.defaultSemiBold : undefined,
        type === "subtitle" ? styles.subtitle : undefined,
        type === "link" ? styles.link : undefined,
        type === "caption" ? styles.caption : undefined,
        type === "heading" ? styles.heading : undefined,
        type === "body" ? styles.body : undefined,
        type === "label" ? styles.label : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 32,
    letterSpacing: -0.25,
  },
  heading: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    letterSpacing: -0.25,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400",
    letterSpacing: 0.1,
  },
  link: {
    lineHeight: 24,
    fontSize: 16,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
});
