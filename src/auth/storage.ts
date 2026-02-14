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
