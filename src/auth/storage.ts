import type { Did } from "@atcute/lexicons";
import type {
  SessionStore,
  StateStore,
  StoredSession,
  StoredState,
} from "@atcute/oauth-node-client";
import type { Storage } from "unstorage";

const SESSION_PREFIX = "auth_session:";
const STATE_PREFIX = "auth_state:";

function sessionKey(did: Did): string {
  return SESSION_PREFIX + did;
}

function stateKey(id: string): string {
  return STATE_PREFIX + id;
}

/** atcute SessionStore backed by unstorage (keyed by DID). */
export function createSessionStore(kv: Storage): SessionStore {
  return {
    async get(key) {
      return (await kv.get<StoredSession>(sessionKey(key))) ?? undefined;
    },
    async set(key, value) {
      await kv.set(sessionKey(key), value);
    },
    async delete(key) {
      await kv.del(sessionKey(key));
    },
    async clear() {
      // atcute does not require clear; no-op (we could scan SESSION_PREFIX keys if needed)
    },
  };
}

/**
 * Host of the authorization server that a stored session refreshes against, or
 * null if there is no stored session yet.
 *
 * This is a local KV read — never a network call — because it is used to pick a
 * circuit-breaker key on the request path (see `restore-guard.ts`). Resolving
 * the DID document instead would mean a network call to decide whether we are
 * allowed to make a network call.
 *
 * `tokenSet.iss` is the token endpoint's origin. For bsky.social users that is
 * the shared entryway; for self-hosted PDSes it is the PDS itself, which is
 * exactly the host that goes unreachable.
 */
export async function getStoredSessionIssuerHost(kv: Storage, did: string): Promise<string | null> {
  try {
    const stored = await kv.get<StoredSession>(sessionKey(did as Did));
    const iss = stored?.tokenSet?.iss;
    return iss ? new URL(iss).host : null;
  } catch {
    return null;
  }
}

/** atcute StateStore backed by unstorage (keyed by state id). */
export function createStateStore(kv: Storage): StateStore {
  return {
    async get(key) {
      return (await kv.get<StoredState>(stateKey(key))) ?? undefined;
    },
    async set(key, value) {
      await kv.set(stateKey(key), value);
    },
    async delete(key) {
      await kv.del(stateKey(key));
    },
    async clear() {
      // no-op
    },
  };
}
