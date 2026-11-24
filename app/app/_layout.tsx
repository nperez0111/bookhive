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
import { ThemeProvider, useTheme } from "@/context/theme";
import { TypographyProvider } from "@/context/typography";
import { View, Platform, AppState } from "react-native";
import { LaunchScreen } from "@/components/LaunchScreen";
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

// Hold only until the first JS surface has laid out, never for network/auth work.
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
    <Stack screenOptions={{ headerShown: false, gestureEnabled: true }}>
      <Stack.Protected guard={!isAuthenticated} redirectTo="/(tabs)">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated} redirectTo="/(auth)/login">
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="search" />
        <Stack.Screen name="feed" />
        <Stack.Screen name="book/[id]" />
        <Stack.Screen name="books/[status]" />
        <Stack.Screen name="profile/[did]" />
        <Stack.Screen name="profile/[did]/stats" />
        <Stack.Screen name="explore/genres/[genre]" />
        <Stack.Screen name="explore/authors/[author]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="account" />
        <Stack.Screen name="import" />
        <Stack.Screen name="lists/index" />
        <Stack.Screen name="lists/[uri]" />
        <Stack.Screen name="library/index" />
        <Stack.Screen name="sync/index" />
      </Stack.Protected>
    </Stack>
  );
}

function AccountCache({ children }: { children: React.ReactNode }) {
  const { isRestoring, sessionEpoch } = useAuth();
  const colorScheme = useColorScheme();
  if (isRestoring)
    return <LaunchScreen theme={colorScheme ?? "light"} message="Restoring your reading space…" />;
  return <SessionCache key={sessionEpoch}>{children}</SessionCache>;
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <TypographyProvider>
        <RootLayoutContent />
      </TypographyProvider>
    </ThemeProvider>
  );
}

function RootLayoutContent() {
  useOTAUpdates();
  const colorScheme = useColorScheme();
  const { isLoaded: themeLoaded } = useTheme();
  // This optional monospace font must not block login, recovery or the app shell.
  const [, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const { top } = useSafeAreaInsets();

  useEffect(() => {
    void AsyncStorage.removeItem("REACT_QUERY_OFFLINE_CACHE").catch(() => {});
  }, []);

  useEffect(() => {
    if (fontError) console.warn("Optional font could not load:", fontError);
  }, [fontError]);

  return (
    <StrictMode>
      <View
        testID="launch-surface"
        style={{ flex: 1, backgroundColor: Colors[colorScheme ?? "light"].background }}
        onLayout={() => {
          void SplashScreen.hideAsync().catch(() => {});
        }}
      >
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        {!themeLoaded ? (
          <LaunchScreen theme={colorScheme ?? "light"} />
        ) : (
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
                        testID="ios-status-area"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: top,
                          backgroundColor: Colors[colorScheme ?? "light"].background,
                          zIndex: 1,
                        }}
                      />
                    )}
                    <View
                      testID="app-safe-area"
                      style={{
                        flex: 1,
                        backgroundColor: Colors[colorScheme ?? "light"].background,
                        paddingTop: Platform.OS === "ios" ? top : 0,
                      }}
                    >
                      <NetworkStatusIndicator />
                      <AuthenticatedNavigation />
                    </View>
                  </NavigationThemeProvider>
                </LanguageProvider>
              </AccountCache>
            </AuthProvider>
          </NetworkErrorBoundary>
        )}
      </View>
    </StrictMode>
  );
}
