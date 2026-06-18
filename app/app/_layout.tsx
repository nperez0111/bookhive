import AsyncStorage from "@react-native-async-storage/async-storage";
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from "expo-router";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, StrictMode, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import "react-native-reanimated";

import { AuthProvider } from "@/context/auth";
import { LanguageProvider } from "@/context/language";
import { ThemeProvider } from "@/context/theme";
import { View, Platform, AppState } from "react-native";
import { useColorScheme } from "@/hooks/useColorScheme";
import { NetworkErrorBoundary } from "@/components/NetworkErrorBoundary";
import { NetworkStatusIndicator } from "@/components/NetworkStatusIndicator";
import { Colors } from "@/constants/Colors";

/**
 * Checks for OTA updates and applies them silently.
 * On non-development builds, checks on mount and when the app
 * returns to foreground after being backgrounded for a while.
 */
function useOTAUpdates() {
  useEffect(() => {
    if (__DEV__) return;

    async function checkAndApplyUpdate() {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          const result = await Updates.fetchUpdateAsync();
          if (result.isNew) {
            // Reload the app to apply the update
            await Updates.reloadAsync();
          }
        }
      } catch (e) {
        // Silently fail — update check is best-effort
        console.log("OTA update check failed:", e);
      }
    }

    // Check on initial mount
    void checkAndApplyUpdate();

    // Also check when app returns from background
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkAndApplyUpdate();
      }
    });

    return () => subscription.remove();
  }, []);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: (failureCount, error: any) => {
        // Don't retry if it's a non-retryable error
        if (error?.networkError && !error.networkError.retryable) {
          return false;
        }
        // Retry up to 3 times for retryable errors
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: (failureCount, error: any) => {
        if (error?.networkError && !error.networkError.retryable) {
          return false;
        }
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
});

export default function RootLayout() {
  useOTAUpdates();
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const { top } = useSafeAreaInsets();

  const [cacheBusterKey, setCacheBusterKey] = useState("");

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <StrictMode>
      <NetworkErrorBoundary>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            buster: `${process.env.NODE_ENV === "development" ? Math.random() : ""}did_${cacheBusterKey}`,
          }}
        >
          <AuthProvider setCacheBustKey={setCacheBusterKey}>
            <LanguageProvider>
              <ThemeProvider>
                <NavigationThemeProvider
                  value={{
                    ...(colorScheme === "dark" ? DarkTheme : DefaultTheme),
                    colors: {
                      ...(colorScheme === "dark" ? DarkTheme.colors : DefaultTheme.colors),
                      primary: Colors[colorScheme ?? "light"].primary,
                      background: Colors[colorScheme ?? "light"].background,
                      text: Colors[colorScheme ?? "light"].text,
                      card: Colors[colorScheme ?? "light"].surfacePrimary,
                      border: Colors[colorScheme ?? "light"].cardBorder,
                    },
                  }}
                >
                  {/* iOS status bar background overlay */}
                  {Platform.OS === "ios" && (
                    <View
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: top,
                        backgroundColor: "#000",
                        zIndex: 1,
                      }}
                    />
                  )}
                  <View
                    style={{
                      flex: 1,
                      paddingTop: Platform.OS === "ios" ? top : 0,
                    }}
                  >
                    <NetworkStatusIndicator />
                    <Stack screenOptions={{ headerShown: false }}>
                      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    </Stack>
                  </View>
                  <StatusBar style="light" />
                </NavigationThemeProvider>
              </ThemeProvider>
            </LanguageProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </NetworkErrorBoundary>
    </StrictMode>
  );
}
