import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { getBaseUrl } from "@/context/auth";
import { useColorScheme } from "@/hooks/useColorScheme";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ofetch } from "ofetch";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

export default function RegisterScreen() {
  const { signIn } = useAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];

  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const spinValue = useRef(new Animated.Value(0)).current;

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Entrance animations
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const validate = (): string | null => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Please enter a valid email address.";
    }
    if (!handle || !/^[a-zA-Z0-9-]{3,20}$/.test(handle)) {
      return "Handle must be 3-20 characters: letters, numbers, and hyphens only.";
    }
    if (password.length < 8) {
      return "Password must be at least 8 characters.";
    }
    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }
    return null;
  };

  const handleSubmit = async () => {
    setError("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);

    // Start loading animation
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
    ).start();

    try {
      const result = await ofetch<{ success: boolean; handle?: string; error?: string }>(
        "/mobile/signup",
        {
          baseURL: getBaseUrl(),
          method: "POST",
          body: { email, handle: handle.toLowerCase(), password },
        },
      );

      if (!result.success) {
        setError(result.error ?? "Failed to create account.");
        return;
      }

      // Account created — kick off OAuth sign-in with the new handle
      await signIn({ handle: result.handle! });

      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        router.replace("/(tabs)");
      });
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "data" in err
          ? (err as { data?: { error?: string } }).data?.error
          : undefined;
      setError(message ?? "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <LinearGradient
        colors={
          colorScheme === "dark"
            ? ["#151718", "#1a1b1c", "#0f1011"]
            : ["#fbbf24", "#fde68a", "#fef3c7"]
        }
        style={styles.gradientBackground}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            {/* Header Section */}
            <Animated.View
              style={[
                styles.headerSection,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              <Animated.Image
                source={require("@/assets/images/bee.png")}
                style={[
                  styles.logo,
                  {
                    transform: [{ rotate: spin }, { scale: scaleAnim }],
                  },
                ]}
              />

              <ThemedText type="title" style={[styles.title, { color: colors.primaryText }]}>
                Create your account
              </ThemedText>

              <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
                Your account will be hosted at{" "}
                <ThemedText style={{ color: colors.primary, fontWeight: "700" }}>
                  bookhive.social
                </ThemedText>
              </ThemedText>
            </Animated.View>

            {/* Form Section */}
            <Animated.View
              style={[
                styles.formSection,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              {error ? (
                <View
                  style={[
                    styles.errorContainer,
                    {
                      backgroundColor:
                        colorScheme === "dark" ? "rgba(239,68,68,0.15)" : "rgba(220,38,38,0.08)",
                      borderColor: colors.error,
                    },
                  ]}
                >
                  <ThemedText style={[styles.errorText, { color: colors.error }]}>
                    {error}
                  </ThemedText>
                </View>
              ) : null}

              <View style={styles.inputGroup}>
                <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                  Email
                </ThemedText>
                <ThemedTextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor:
                        colorScheme === "dark" ? colors.cardBackground : "#ffffff",
                      borderColor: colors.cardBorder,
                      color: colors.primaryText,
                    },
                  ]}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.placeholderText}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!isLoading}
                />
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                  Handle
                </ThemedText>
                <View style={styles.handleRow}>
                  <ThemedTextInput
                    style={[
                      styles.input,
                      styles.handleInput,
                      {
                        backgroundColor:
                          colorScheme === "dark" ? colors.cardBackground : "#ffffff",
                        borderColor: colors.cardBorder,
                        color: colors.primaryText,
                      },
                    ]}
                    placeholder="yourname"
                    placeholderTextColor={colors.placeholderText}
                    value={handle}
                    onChangeText={setHandle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="username"
                    editable={!isLoading}
                  />
                  <View
                    style={[
                      styles.handleSuffix,
                      {
                        backgroundColor:
                          colorScheme === "dark" ? colors.surfaceTertiary : "#f5f0e0",
                        borderColor: colors.cardBorder,
                      },
                    ]}
                  >
                    <ThemedText style={[styles.handleSuffixText, { color: colors.secondaryText }]}>
                      .bookhive.social
                    </ThemedText>
                  </View>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                  Password
                </ThemedText>
                <ThemedTextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor:
                        colorScheme === "dark" ? colors.cardBackground : "#ffffff",
                      borderColor: colors.cardBorder,
                      color: colors.primaryText,
                    },
                  ]}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.placeholderText}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="newPassword"
                  editable={!isLoading}
                />
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                  Confirm Password
                </ThemedText>
                <ThemedTextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor:
                        colorScheme === "dark" ? colors.cardBackground : "#ffffff",
                      borderColor: colors.cardBorder,
                      color: colors.primaryText,
                    },
                  ]}
                  placeholder="Re-enter your password"
                  placeholderTextColor={colors.placeholderText}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  textContentType="newPassword"
                  editable={!isLoading}
                  onSubmitEditing={handleSubmit}
                />
              </View>

              <View
                style={[
                  styles.infoBox,
                  {
                    backgroundColor:
                      colorScheme === "dark" ? "rgba(245,158,11,0.1)" : "rgba(217,119,6,0.06)",
                    borderColor:
                      colorScheme === "dark" ? "rgba(245,158,11,0.25)" : "rgba(217,119,6,0.15)",
                  },
                ]}
              >
                <ThemedText style={[styles.infoText, { color: colors.secondaryText }]}>
                  After your account is created, you'll sign in with the password you just chose to
                  complete setup.
                </ThemedText>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  isLoading && styles.buttonLoading,
                ]}
                onPress={handleSubmit}
                disabled={isLoading}
              >
                <LinearGradient
                  colors={[colors.primary, colors.primaryLight]}
                  style={styles.buttonGradient}
                >
                  <ThemedText style={[styles.buttonText, { color: colors.background }]}>
                    {isLoading ? "Creating account..." : "Create account"}
                  </ThemedText>
                </LinearGradient>
              </Pressable>

              <ThemedText style={[styles.legalText, { color: colors.tertiaryText }]}>
                By creating an account you agree to our Terms of Service and Privacy Policy.
              </ThemedText>

              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [
                  styles.existingAccountLink,
                  pressed && styles.existingAccountLinkPressed,
                ]}
              >
                <ThemedText style={[styles.existingAccountText, { color: colors.primary }]}>
                  Already have a Bluesky account? Sign in
                </ThemedText>
              </Pressable>
            </Animated.View>
          </View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradientBackground: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  headerSection: {
    alignItems: "center",
    marginBottom: 36,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -1,
    marginBottom: 12,
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  formSection: {
    alignItems: "center",
    gap: 16,
  },
  errorContainer: {
    width: "100%",
    maxWidth: 320,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  inputGroup: {
    width: "100%",
    maxWidth: 320,
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },
  input: {
    width: "100%",
    height: 52,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  handleInput: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  handleSuffix: {
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderLeftWidth: 0,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  handleSuffixText: {
    fontSize: 13,
    fontWeight: "500",
  },
  infoBox: {
    width: "100%",
    maxWidth: 320,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  infoText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  button: {
    width: "100%",
    maxWidth: 320,
    height: 56,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonGradient: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
  buttonLoading: {
    opacity: 0.8,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  legalText: {
    fontSize: 12,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 17,
  },
  existingAccountLink: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  existingAccountLinkPressed: {
    opacity: 0.7,
  },
  existingAccountText: {
    fontSize: 15,
    textAlign: "center",
    textDecorationLine: "underline",
  },
});
