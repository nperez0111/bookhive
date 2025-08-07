import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, StrictMode, useState } from "react";

import "react-native-reanimated";

import { AuthProvider } from "@/context/auth";
import { ThemeProvider } from "@/context/theme";
import { useColorScheme } from "react-native";
import { NetworkErrorBoundary } from "@/components/NetworkErrorBoundary";
import { NetworkStatusIndicator } from "@/components/NetworkStatusIndicator";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

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
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  const [cacheBusterKey, setCacheBusterKey] = useState("");

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
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
            <ThemeProvider>
              <NavigationThemeProvider
                value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
              >
                <NetworkStatusIndicator />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen
                    name="(auth)"
                    options={{ headerShown: false }}
                  />
                  <Stack.Screen
                    name="(tabs)"
                    options={{ headerShown: false }}
                  />
                </Stack>
                <StatusBar style="auto" />
              </NavigationThemeProvider>
            </ThemeProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </NetworkErrorBoundary>
    </StrictMode>
  );
}
