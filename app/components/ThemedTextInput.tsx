import { TextInput, TextInputProps } from "react-native";

import { useThemeColor } from "@/hooks/useThemeColor";

export type ThemedTextInputProps = TextInputProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedTextInput({
  style,
  lightColor,
  darkColor,
  ...rest
}: ThemedTextInputProps) {
  const backgroundColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    "background",
  );
  const color = useThemeColor({ light: darkColor, dark: lightColor }, "text");

  return <TextInput style={[{ backgroundColor, color }, style]} {...rest} />;
}
