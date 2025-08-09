import { ThemedText } from "@/components/ThemedText";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useColorScheme } from "@/hooks/useColorScheme";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const [handle, setHandle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const spinValue = useRef(new Animated.Value(0)).current;
  const inputScaleAnim = useRef(new Animated.Value(1)).current;

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

  // Input focus animation
  useEffect(() => {
    Animated.timing(inputScaleAnim, {
      toValue: isFocused ? 1.02 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isFocused]);

  const handleSubmit = async () => {
    if (!handle) return;
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
      await signIn({ handle });
      // Success animation before navigation
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        router.replace("/(tabs)");
      });
    } catch (error) {
      console.error(error);
      // Reset animations on error
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
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

            <ThemedText
              type="title"
              style={[styles.title, { color: colors.primaryText }]}
            >
              Welcome to BookHive
            </ThemedText>

            <ThemedText
              style={[styles.subtitle, { color: colors.secondaryText }]}
            >
              Connect with your Bluesky account to start buzzing about books
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
            <Animated.View
              style={[
                styles.inputContainer,
                {
                  transform: [{ scale: inputScaleAnim }],
                },
              ]}
            >
              <ThemedTextInput
                style={[
                  styles.input,
                  {
                    backgroundColor:
                      colorScheme === "dark"
                        ? colors.cardBackground
                        : "#ffffff",
                    borderColor: isFocused ? colors.primary : colors.cardBorder,
                    color: colors.primaryText,
                  },
                  isFocused && {
                    shadowColor: colors.primary,
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 4,
                  },
                ]}
                placeholder="Enter your Bluesky handle"
                placeholderTextColor={colors.placeholderText}
                value={handle}
                onChangeText={setHandle}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                onSubmitEditing={handleSubmit}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
              />
            </Animated.View>

            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                isLoading && styles.buttonLoading,
              ]}
              onPress={handleSubmit}
              disabled={isLoading || !handle}
            >
              <LinearGradient
                colors={
                  handle
                    ? [colors.primary, colors.primaryLight]
                    : [colors.buttonBackground, colors.buttonBackground]
                }
                style={styles.buttonGradient}
              >
                <ThemedText
                  style={[
                    styles.buttonText,
                    {
                      color: handle ? colors.background : colors.tertiaryText,
                    },
                  ]}
                >
                  {isLoading ? "Buzzing in..." : "Buzz in"}
                </ThemedText>
              </LinearGradient>
            </Pressable>

            <ThemedText
              style={[styles.footerText, { color: colors.tertiaryText }]}
            >
              Your reading journey starts here 🐝
            </ThemedText>
          </Animated.View>
        </View>
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
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  headerSection: {
    alignItems: "center",
    marginBottom: 60,
  },
  logo: {
    width: 150,
    height: 150,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -1,
    marginBottom: 16,
    lineHeight: 44,
  },
  subtitle: {
    fontSize: 18,
    textAlign: "center",
    lineHeight: 26,
    paddingHorizontal: 20,
    maxWidth: 300,
  },
  formSection: {
    alignItems: "center",
    gap: 24,
  },
  inputContainer: {
    width: "100%",
    maxWidth: 320,
  },
  input: {
    width: "100%",
    height: 60,
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 24,
    fontSize: 18,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  button: {
    width: "100%",
    maxWidth: 320,
    height: 60,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 6,
    },
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
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  footerText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 16,
  },
});
