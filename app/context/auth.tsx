import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { ofetch, type FetchOptions } from "ofetch";
import { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import {
  createAuthSessionScope,
  isTerminalRefreshStatus,
  parseAuthState,
  type AuthState,
} from "./authSession";

export type { AuthState } from "./authSession";
export type SignInResult = "success" | "cancelled";
export const getBaseUrl = () =>
  (process.env.EXPO_PUBLIC_API_URL || "https://bookhive.buzz").replace(/\/$/, "");

export const authSession = createAuthSessionScope();
export const getAuthState = () => authSession.state;

const fetchClient = ofetch.create({
  baseURL: getBaseUrl(),
  credentials: "omit",
  retry: 0,
  timeout: 15_000,
  headers: {
    accept: "application/json",
    "x-bookhive-version":
      Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "unknown",
    "x-bookhive-platform": Platform.OS,
    "x-bookhive-platform-version": String(Platform.Version),
  },
});

/** Capture in a hook/render or before a multi-step operation, never after an await. */
export function createSessionFetch() {
  const scope = authSession.capture();
  return async function sessionFetch<T>(
    url: string,
    options: FetchOptions<"json"> = {},
  ): Promise<T> {
    scope.assertCurrent();
    const headers = new Headers(options.headers);
    headers.delete("cookie");
    if (scope.state) headers.set("cookie", `sid=${scope.state.sid}`);
    // RN versions do not all implement AbortSignal.any.
    const controller = new AbortController();
    const abort = () => controller.abort();
    scope.signal.addEventListener("abort", abort);
    options.signal?.addEventListener("abort", abort);
    if (scope.signal.aborted || options.signal?.aborted) abort();
    try {
      const result = await fetchClient<T>(url, {
        ...options,
        headers,
        signal: controller.signal,
        credentials: "omit",
        retry: 0,
      });
      scope.assertCurrent();
      return result;
    } finally {
      scope.signal.removeEventListener("abort", abort);
      options.signal?.removeEventListener("abort", abort);
    }
  };
}
export function authFetch<T>(url: string, options?: FetchOptions<"json">): Promise<T> {
  return createSessionFetch()<T>(url, options);
}

// Serialize writes so a slow sign-in save cannot resurrect a later logout.
let storageQueue = Promise.resolve();
function persistAuth(state: AuthState | null, expectedEpoch?: number) {
  const work = storageQueue
    .catch(() => {})
    .then(async () => {
      if (expectedEpoch !== undefined && authSession.epoch !== expectedEpoch) return;
      if (Platform.OS === "web") {
        await AsyncStorage.removeItem("authState");
        return;
      }
      if (state) await SecureStore.setItemAsync("authState", JSON.stringify(state));
      else await SecureStore.deleteItemAsync("authState");
      await AsyncStorage.removeItem("authState");
    });
  storageQueue = work;
  return work;
}

let restoration: Promise<AuthState | null> | undefined;
let restorationComplete = false;
async function restoreAuth(): Promise<AuthState | null> {
  const epoch = authSession.epoch;
  const stored = Platform.OS === "web" ? null : await SecureStore.getItemAsync("authState");
  const legacy = stored ? null : await AsyncStorage.getItem("authState");
  let saved: AuthState | null;
  try {
    saved = parseAuthState(JSON.parse(stored ?? legacy ?? "null"));
  } catch {
    saved = null;
  }
  if (!saved) {
    await persistAuth(null, epoch);
    return null;
  }
  await persistAuth(saved, epoch);
  try {
    const result = await fetchClient<{ success: boolean; payload?: { sid: string; did: string } }>(
      "/mobile/refresh-token",
      { headers: { cookie: `sid=${saved.sid}` } },
    );
    const next = parseAuthState({ ...saved, ...result.payload });
    if (!result.success || !next || next.did !== saved.did) return saved;
    await persistAuth(next, epoch);
    return next;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (isTerminalRefreshStatus(status)) {
      await persistAuth(null, epoch);
      return null;
    }
    return saved; // Offline, PDS timeout or server failure is not a logout.
  }
}

type AuthContextValue = {
  authState: AuthState | null;
  isAuthenticated: boolean;
  isRestoring: boolean;
  sessionEpoch: number;
  signIn: (ctx: { handle: string }) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState(getAuthState);
  const [isRestoring, setRestoring] = useState(!restorationComplete);
  const [sessionEpoch, setEpoch] = useState(authSession.epoch);
  useEffect(
    () =>
      authSession.subscribe(() => {
        setAuthState(getAuthState());
        setEpoch(authSession.epoch);
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    const epoch = authSession.epoch;
    restoration ??= restoreAuth()
      .then((saved) => {
        // Apply exactly once per process, not on every provider remount.
        if (epoch === authSession.epoch) authSession.replace(saved);
        return saved;
      })
      .finally(() => {
        restorationComplete = true;
      });
    void restoration
      .catch(() => {
        // Storage unavailable: stay signed out without deleting recoverable credentials.
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = async ({ handle }: { handle: string }): Promise<SignInResult> => {
    const epoch = authSession.epoch;
    const deepLink = Linking.createURL("/oauth-callback");
    const params = new URLSearchParams({ handle: handle.trim(), redirect_uri: deepLink });
    const result = await WebBrowser.openAuthSessionAsync(
      `${getBaseUrl()}/mobile/login?${params}`,
      deepLink,
    );
    if (result.type !== "success" || epoch !== authSession.epoch) return "cancelled";
    const callback = new URL(result.url);
    const expected = new URL(deepLink);
    if (
      callback.protocol !== expected.protocol ||
      callback.host !== expected.host ||
      callback.pathname !== expected.pathname
    ) {
      throw new Error("Unexpected login callback");
    }
    const next = parseAuthState(Object.fromEntries(callback.searchParams));
    if (!next) throw new Error("Login response is missing session information");
    await persistAuth(next, epoch);
    if (epoch !== authSession.epoch) return "cancelled";
    authSession.replace(next);
    return "success";
  };
  const signOut = async () => {
    authSession.replace(null);
    await persistAuth(null);
  };
  return (
    <AuthContext.Provider
      value={{
        authState,
        isAuthenticated: !!authState,
        isRestoring,
        sessionEpoch,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
