import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from "expo-router";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, StrictMode, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import "react-native-reanimated";

import { AuthProvider, authSession, useAuth, getBaseUrl } from "@/context/auth";
import { accountCacheKey, epochStorage } from "@/context/authSession";
import { LanguageProvider } from "@/context/language";
import { ThemeProvider } from "@/context/theme";
import { View, Platform, AppState, ActivityIndicator } from "react-native";
import { useColorScheme } from "@/hooks/useColorScheme";
import { NetworkErrorBoundary } from "@/components/NetworkErrorBoundary";
import { NetworkStatusIndicator } from "@/components/NetworkStatusIndicator";
import { Colors } from "@/constants/Colors";
import { shouldPersistQuery } from "@/utils/queryPersistence";
import { shouldRetryQuery } from "@/utils/networkErrorHandler";

/**
 * Download OTA updates for the next cold start; never interrupt active work.
 * On non-development builds, checks on mount and when the app
 * returns to foreground after being backgrounded for a while.
 */
function useOTAUpdates() {
  useEffect(() => {
    if (__DEV__) return;

    let checking = false;
    let lastCheck = 0;
    async function checkAndApplyUpdate() {
      if (checking || Date.now() - lastCheck < 15 * 60 * 1000) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
        }
      } catch (e) {
        // Best-effort — failures are logged, not surfaced.
        console.log("OTA update check failed:", e);
      } finally {
        checking = false;
      }
    }

    void checkAndApplyUpdate();

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

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 1000 * 60 * 60 * 24, // 24 hours
        retry: shouldRetryQuery,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      },
      mutations: {
        retry: false,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      },
    },
  });
}

function SessionCache({ children }: { children: React.ReactNode }) {
  const { authState, sessionEpoch } = useAuth();
  const [queryClient] = useState(createQueryClient);
  const [persister] = useState(() =>
    createAsyncStoragePersister({
      key: accountCacheKey(getBaseUrl(), authState?.did),
      storage: epochStorage(AsyncStorage, () => authSession.epoch === sessionEpoch),
    }),
  );
  useEffect(() => {
    const clear = () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    };
    const unsubscribe = authSession.subscribe(clear);
    return () => {
      unsubscribe();
      clear();
    };
  }, [queryClient]);
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: "session-cache-v3",
        dehydrateOptions: {
          shouldDehydrateMutation: () => false,
          shouldDehydrateQuery: shouldPersistQuery,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

function AuthenticatedNavigation() {
  const { isAuthenticated } = useAuth();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}

function AccountCache({ children }: { children: React.ReactNode }) {
  const { isRestoring, sessionEpoch } = useAuth();
  if (isRestoring)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator accessibilityLabel="Restoring session" />
      </View>
    );
  return <SessionCache key={sessionEpoch}>{children}</SessionCache>;
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
}

function RootLayoutContent() {
  useOTAUpdates();
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const { top } = useSafeAreaInsets();

  useEffect(() => {
    void AsyncStorage.removeItem("REACT_QUERY_OFFLINE_CACHE").catch(() => {});
  }, []);

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
        <AuthProvider>
          <AccountCache>
            <LanguageProvider>
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
                  <AuthenticatedNavigation />
                </View>
                <StatusBar style="light" />
              </NavigationThemeProvider>
            </LanguageProvider>
          </AccountCache>
        </AuthProvider>
      </NetworkErrorBoundary>
    </StrictMode>
  );
}
