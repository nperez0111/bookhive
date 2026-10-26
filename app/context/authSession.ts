export type AuthState = { did: string; handle: string; sid: string };

export function parseAuthState(value: unknown): AuthState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AuthState>;
  return [candidate.did, candidate.handle, candidate.sid].every(
    (field) => typeof field === "string" && field.trim().length > 0,
  )
    ? (candidate as AuthState)
    : null;
}

/** An epoch, not just a DID: logging back into A must not revive A's old work. */
export function createAuthSessionScope() {
  let state: AuthState | null = null;
  let epoch = 0;
  let controller = new AbortController();
  const listeners = new Set<() => void>();
  return {
    get state() {
      return state;
    },
    get epoch() {
      return epoch;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace(next: AuthState | null) {
      controller.abort();
      state = next;
      epoch++;
      controller = new AbortController();
      for (const listener of listeners) listener();
    },
    capture() {
      const capturedEpoch = epoch;
      const capturedState = state;
      const signal = controller.signal;
      return {
        state: capturedState,
        signal,
        assertCurrent() {
          if (capturedEpoch !== epoch || signal.aborted) {
            throw new Error("Authentication session changed; request cancelled");
          }
        },
      };
    },
  };
}

export function isTerminalRefreshStatus(status: number | undefined) {
  return status === 401 || status === 403;
}

export function accountCacheKey(origin: string, did: string | undefined) {
  return `bookhive-query-v2:${encodeURIComponent(origin)}:${did ?? "anonymous"}`;
}

/** A delayed persister flush from an unmounted account must become a no-op. */
export function epochStorage(
  storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  },
  isCurrent: () => boolean,
) {
  return {
    getItem: (key: string) => storage.getItem(key),
    setItem: (key: string, value: string) =>
      isCurrent() ? storage.setItem(key, value) : Promise.resolve(),
    removeItem: (key: string) => storage.removeItem(key),
  };
}
