import type { TextInputProps } from "react-native";

import { useThemeColor } from "@/hooks/useThemeColor";
import { AppTextInput } from "./AppTextInput";

export type ThemedTextInputProps = TextInputProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedTextInput({ style, lightColor, darkColor, ...rest }: ThemedTextInputProps) {
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, "background");
  const color = useThemeColor({ light: darkColor, dark: lightColor }, "text");
  const placeholderColor = useThemeColor({}, "placeholderText");

  return (
    <AppTextInput
      style={[{ backgroundColor, color }, style]}
      {...rest}
      placeholderTextColor={rest.placeholderTextColor ?? placeholderColor}
    />
  );
}
