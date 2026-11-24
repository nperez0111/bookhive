import { Image, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/Colors";
import { useSansFont } from "@/context/typography";

/** The same centered, transparent mark as the native splash. No entrance motion. */
export function LaunchScreen({
  theme,
  message = "Opening your reading space…",
}: {
  theme: "light" | "dark";
  message?: string;
}) {
  const colors = Colors[theme];
  const fontFamily = useSansFont();
  return (
    <View testID="launch-screen" style={[styles.screen, { backgroundColor: colors.background }]}>
      <Image
        source={require("../assets/images/bee.png")}
        style={styles.mark}
        resizeMode="contain"
        accessible={false}
      />
      <View style={styles.caption}>
        <Text style={[styles.name, { color: colors.text, fontFamily }]}>BookHive</Text>
        <Text
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: colors.secondaryText, fontFamily }]}
        >
          {message}
        </Text>
        <View accessible={false} style={[styles.rule, { backgroundColor: colors.primary }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  mark: { width: 160, height: 160 },
  caption: {
    position: "absolute",
    top: "50%",
    marginTop: 100,
    left: 24,
    right: 24,
    alignItems: "center",
    gap: 12,
  },
  name: { fontSize: 26, fontWeight: "700", letterSpacing: -0.6 },
  message: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  rule: { width: 28, height: 3, borderRadius: 2, marginTop: 4 },
});
