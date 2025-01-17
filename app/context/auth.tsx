import { router } from "expo-router";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";

type AuthState = {
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
const initialAuthPromise = (async () => {
  const authState = await AsyncStorage.getItem("authState");
  try {
    currentAuthState = authState ? JSON.parse(authState) : null;
  } catch (error) {
    // ignore
    return;
  }
})();
export const getAuthState = (): AuthState | null => {
  return currentAuthState;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState | null>(() =>
    getAuthState(),
  );

  // Perhaps it had not been loaded yet
  useEffect(() => {
    if (!authState) {
      initialAuthPromise.then(() => {
        setAuthState(getAuthState());
      });
    }
  }, []);

  const signIn = async ({ handle }: { handle: string }) => {
    // Start auth flow
    const deepLink = Linking.createURL("/oauth-callback");
    const authUrl = `http://localhost:8080/mobile/login?&handle=${handle}&redirect_uri=${deepLink}`;
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
        await AsyncStorage.setItem("authState", JSON.stringify(authState));
        setAuthState(authState);
        router.replace("/(app)");
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
