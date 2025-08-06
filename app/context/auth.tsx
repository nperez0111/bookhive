import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ofetch } from "ofetch";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

export type AuthState = {
  /**
   * User's did
   */
  did: string;
  /**
   * User's handle
   */
  handle: string;
  /**
   * User's session id
   */
  sid: string;
};

export const getBaseUrl = () => {
  return process.env.NODE_ENV === "development"
    ? "http://localhost:8080"
    : "https://bookhive.buzz";
};

const AuthContext = createContext<
  {
    signIn: (ctx: { handle: string }) => Promise<void>;
    signOut: () => Promise<void>;
  } & (
    | {
        isAuthenticated: false;
        authState: null;
      }
    | {
        isAuthenticated: true;
        authState: AuthState;
      }
  )
>({
  isAuthenticated: false,
  signIn: async () => {},
  signOut: async () => {},
  authState: null,
});

let currentAuthState: AuthState | null = null;

export const getAuthState = (): AuthState | null => {
  return currentAuthState;
};

export const authFetch = ofetch.create({
  headers: {
    accept: "application/json",
    ["x-bookhive-version"]: "1.0.0",
    ["x-bookhive-platform"]: Platform.OS,
    ["x-bookhive-platform-version"]: String(Platform.Version),
  },
  baseURL: getBaseUrl(),
  onRequest({ options }) {
    // Add the most recent session id to the headers
    options.headers.append("cookie", `sid=${getAuthState()?.sid}`);
  },
});

const initialAuthPromise = (async () => {
  const authState = await AsyncStorage.getItem("authState");
  try {
    currentAuthState = authState ? JSON.parse(authState) : null;

    // Try to refresh the token
    if (authState) {
      const response = await authFetch<{
        success: true;
        payload: { sid: string; did: string };
      }>("/mobile/refresh-token");

      if (response.success) {
        const nextAuthState = {
          sid: String(response.payload.sid),
          did: String(response.payload.did),
          handle: String(currentAuthState?.handle),
        };
        if (nextAuthState.did && nextAuthState.handle && nextAuthState.sid) {
          currentAuthState = nextAuthState;
        }
        await AsyncStorage.setItem(
          "authState",
          JSON.stringify(currentAuthState),
        );
      }
    }
  } catch (error) {
    await AsyncStorage.removeItem("authState");
    currentAuthState = null;
  }
})();

export function AuthProvider({
  setCacheBustKey,
  children,
}: {
  setCacheBustKey: (key: string) => void;
  children: React.ReactNode;
}) {
  const [authState, setAuthState] = useState<AuthState | null>(() =>
    getAuthState(),
  );

  // Perhaps it had not been loaded yet
  useEffect(() => {
    if (!authState) {
      initialAuthPromise.then(() => {
        setAuthState(getAuthState());
        setCacheBustKey(getAuthState()?.did ?? "");
      });
    }
  }, []);

  const signIn = async ({ handle }: { handle: string }) => {
    // Start auth flow
    const deepLink = Linking.createURL("/oauth-callback");
    const authUrl = `${getBaseUrl()}/mobile/login?&handle=${handle}&redirect_uri=${deepLink}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, deepLink);
    if (result.type === "success") {
      // Handle successful auth
      const { url } = result;
      const params = new URL(url).searchParams;
      const authState = {
        did: params.get("did")!,
        handle: params.get("handle")!,
        sid: params.get("sid")!,
      };

      if (authState.did && authState.handle && authState.sid) {
        currentAuthState = authState;
        await AsyncStorage.setItem("authState", JSON.stringify(authState));
        setAuthState(authState);
        router.replace("/(tabs)");
      }
    }
  };

  const signOut = async () => {
    await AsyncStorage.removeItem("authState");
    setAuthState(null);
  };

  const contextValue = useMemo(() => {
    return authState === null
      ? ({ isAuthenticated: false, authState: null, signIn, signOut } as const)
      : ({ isAuthenticated: true, authState, signIn, signOut } as const);
  }, [authState]);

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
