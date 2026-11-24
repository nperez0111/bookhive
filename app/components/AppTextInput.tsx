import { TextInput, type TextInputProps } from "react-native";
import { useSansFont } from "@/context/typography";

/** Shared typography without changing native input behavior or adding theme colors. */
export function AppTextInput({ style, ...props }: TextInputProps) {
  const fontFamily = useSansFont();
  return <TextInput {...props} style={[{ fontFamily }, style]} />;
}
