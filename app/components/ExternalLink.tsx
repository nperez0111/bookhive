import { openBrowserAsync } from "expo-web-browser";
import { type ComponentProps } from "react";
import { Platform, Pressable } from "react-native";
import { ThemedText } from "./ThemedText";

type Props = {
  href: string;
  children: React.ReactNode;
  style?: any;
};

export function ExternalLink({ href, children, style, ...rest }: Props) {
  return (
    <Pressable
      {...rest}
      style={style}
      onPress={async () => {
        if (Platform.OS !== "web") {
          // Open the link in an in-app browser.
          await openBrowserAsync(href);
        } else {
          // On web, open in new tab
          window.open(href, "_blank");
        }
      }}
    >
      {typeof children === "string" ? (
        <ThemedText type="link" style={style}>
          {children}
        </ThemedText>
      ) : (
        children
      )}
    </Pressable>
  );
}
