import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, type PressableProps } from "react-native";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { ThemedText } from "./ThemedText";

type HeaderActionProps = Omit<PressableProps, "children"> & {
  title?: string;
  children?: ReactNode;
  loading?: boolean;
  tone?: "primary" | "neutral";
};

/** Visible button treatment shared by page and section header actions. */
export function HeaderAction({
  title,
  children,
  loading,
  tone = "primary",
  style,
  disabled,
  ...props
}: HeaderActionProps) {
  const colors = Colors[useColorScheme() ?? "light"];
  const foreground = tone === "primary" ? colors.accentForeground : colors.primaryText;
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? title}
      accessibilityState={{
        ...props.accessibilityState,
        disabled: !!(disabled || loading),
        busy: !!loading,
      }}
      disabled={disabled || loading}
      style={(state) => [
        {
          minHeight: 44,
          minWidth: 44,
          maxWidth: "100%",
          width: title ? undefined : 44,
          paddingHorizontal: title ? 12 : 10,
          borderWidth: 1,
          borderRadius: 12,
          borderColor: tone === "primary" ? colors.primary : colors.cardBorder,
          backgroundColor: state.pressed ? colors.activeBackground : "transparent",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: disabled ? 0.5 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={foreground} /> : children}
      {title && (
        <ThemedText type="label" style={{ color: foreground, flexShrink: 1 }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}
