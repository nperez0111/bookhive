import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemedButton } from "@/components/ThemedButton";
import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useColorScheme } from "@/hooks/useColorScheme";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const STORED_HANDLE_KEY = "bookhive_last_handle";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { handle: handleParam } = useLocalSearchParams<{ handle?: string | string[] }>();
  // Query parameters are runtime input: repeated keys produce arrays.
  const requestedHandle = typeof handleParam === "string" ? handleParam : undefined;
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const insets = useSafeAreaInsets();
  const [handle, setHandle] = useState(requestedHandle ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const submitting = useRef(false);
  const edited = useRef(false);

  useEffect(() => {
    let active = true;
    const remembered = requestedHandle
      ? Promise.resolve(requestedHandle)
      : AsyncStorage.getItem(STORED_HANDLE_KEY);
    void remembered
      .then((stored) => {
        if (active && (requestedHandle || !edited.current) && stored) setHandle(stored);
      })
      .catch((error) => console.error("Failed to load stored handle:", error));
    return () => {
      active = false;
    };
  }, [requestedHandle]);

  const handleSubmit = async () => {
    const accountHandle = handle.trim();
    if (!accountHandle || submitting.current) return;
    submitting.current = true;
    setError("");
    setIsLoading(true);
    try {
      try {
        await AsyncStorage.setItem(STORED_HANDLE_KEY, accountHandle);
      } catch (error) {
        console.error("Failed to save handle:", error);
      }
      // Protected routes navigate only after successful authentication.
      await signIn({ handle: accountHandle });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign in. Please try again.");
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(24, insets.bottom) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.brand}>
            <Image
              source={require("@/assets/images/bee.png")}
              style={styles.logo}
              accessible={false}
            />
            <ThemedText type="heading">BookHive</ThemedText>
          </View>
          <View style={styles.introduction}>
            <ThemedText accessibilityRole="header" type="title" style={styles.title}>
              Your next chapter starts here.
            </ThemedText>
            <ThemedText style={{ color: colors.secondaryText }}>
              Keep track of your reading and find your next book with friends.
            </ThemedText>
          </View>
          <View style={styles.form}>
            <ThemedText type="heading" accessibilityRole="header">
              Sign in
            </ThemedText>
            <View style={styles.field}>
              <ThemedText type="label">Bluesky or AT Protocol handle</ThemedText>
              <ThemedTextInput
                accessibilityLabel="Bluesky or AT Protocol handle"
                accessibilityHint="For example, yourname.bsky.social or your own domain"
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.cardBackground,
                    borderColor: error
                      ? colors.errorText
                      : isFocused
                        ? colors.primary
                        : colors.cardBorder,
                    color: colors.primaryText,
                  },
                ]}
                placeholder="yourname.bsky.social"
                placeholderTextColor={colors.placeholderText}
                value={handle}
                onChangeText={(value) => {
                  edited.current = true;
                  setHandle(value);
                  if (error) setError("");
                }}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                returnKeyType="go"
                editable={!isLoading}
                onSubmitEditing={handleSubmit}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
              />
              <ThemedText type="caption" style={{ color: colors.secondaryText }}>
                You’ll continue to your account provider to sign in securely. No password needed
                here.
              </ThemedText>
            </View>
            {!!error && (
              <ThemedText accessibilityRole="alert" style={{ color: colors.errorText }}>
                {error}
              </ThemedText>
            )}
            <ThemedButton
              title={isLoading ? "Opening sign in…" : "Continue"}
              accessibilityLabel={isLoading ? "Opening sign in" : "Continue to sign in"}
              onPress={handleSubmit}
              loading={isLoading}
              disabled={isLoading || !handle.trim()}
              style={styles.continueButton}
              static
            />
            {isLoading && (
              <ThemedText
                accessibilityLiveRegion="polite"
                type="caption"
                style={{ color: colors.secondaryText }}
              >
                Complete sign in with your account provider, then return to BookHive.
              </ThemedText>
            )}
          </View>
          <View style={[styles.createAccount, { borderTopColor: colors.cardBorder }]}>
            <ThemedText style={{ color: colors.secondaryText }}>
              New to Bluesky or AT Protocol?
            </ThemedText>
            <ThemedButton
              title="Create an account"
              variant="secondary"
              onPress={() => router.push("/(auth)/register")}
              disabled={isLoading}
              static
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingTop: 32 },
  content: { width: "100%", maxWidth: 440, alignSelf: "center", gap: 28 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 44, height: 44, resizeMode: "contain" },
  introduction: { gap: 12 },
  title: { fontSize: 32, lineHeight: 38 },
  form: { gap: 16 },
  field: { gap: 8 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  continueButton: { minHeight: 52 },
  createAccount: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24, gap: 12 },
});
