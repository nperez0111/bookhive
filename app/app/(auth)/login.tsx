import { router } from "expo-router";
import {
  StyleSheet,
  TextInput,
  Image,
  Animated,
  Pressable,
} from "react-native";
import { useState, useRef } from "react";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { ThemedTextInput } from "@/components/ThemedTextInput";
import { useAuth } from "@/context/auth";
import ParallaxScrollView from "@/components/ParallaxScrollView";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [handle, setHandle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const spinValue = useRef(new Animated.Value(0)).current;

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const handleSubmit = async () => {
    if (!handle) return;
    setIsLoading(true);

    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0.7,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ),
    ]).start();

    try {
      await signIn({ handle });
      // Success animation before navigation
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
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
    <ParallaxScrollView
      headerBackgroundColor={{ light: "#A1CEDC", dark: "#1D3D47" }}
      headerImage={
        <Image
          source={require("@/assets/images/partial-react-logo.png")}
          style={styles.hero}
        />
      }
    >
      <ThemedView darkColor="#333" style={styles.formContainer}>
        <Animated.Image
          source={require("@/assets/images/bee.png")}
          style={[styles.logo, { transform: [{ rotate: spin }] }]}
        />

        <ThemedText type="title" style={styles.title}>
          Welcome to BookHive!
        </ThemedText>

        <ThemedTextInput
          style={styles.input}
          placeholder="Enter your Bluesky handle"
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
          onSubmitEditing={handleSubmit}
        />

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            isLoading && styles.buttonLoading,
          ]}
          onPress={handleSubmit}
          disabled={isLoading || !handle}
        >
          <ThemedText style={styles.buttonText}>
            {isLoading ? "Buzzing in..." : "Login"}
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  hero: {
    width: "100%",
    height: 200,
  },
  formContainer: {
    flex: 1,
    borderRadius: 24,
    marginTop: -24,
    padding: 16,
    alignItems: "center",
    gap: 24,
  },
  logo: {
    width: 80,
    height: 80,
    marginTop: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
  },
  input: {
    width: "100%",
    height: 50,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  button: {
    width: "100%",
    height: 50,
    backgroundColor: "#fbbf24",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonPressed: {
    backgroundColor: "#f59e0b",
  },
  buttonLoading: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
