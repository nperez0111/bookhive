/**
 * Worker-specific dependency setup.
 * Creates own DB/KV connections and restores OAuth from a pre-fetched StoredSession.
 */
import type { Did } from "@atcute/lexicons";
import type { StoredSession, SessionStore, StateStore } from "@atcute/oauth-node-client";
import { createStorage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

import {
  createOAuthClient,
  sessionClientFromOAuthSession,
  type SessionClient,
} from "../../auth/client";
import { createDb } from "../../db";
import sqliteKv, { createSharedKvDb } from "../../sqlite-kv";
import { createServiceAccountAgent } from "../../utils/catalogBookService";
import { env } from "../../env";
import type { ImportContext } from "./types";

/** In-memory SessionStore pre-populated with a single session. */
function createInMemorySessionStore(did: string, session: StoredSession): SessionStore {
  const store = new Map<string, StoredSession>([[did, session]]);
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
}

/** No-op StateStore — the worker never initiates OAuth flows. */
function createNoopStateStore(): StateStore {
  return {
    async get() {
      return undefined;
    },
    async set() {},
    async delete() {},
    async clear() {},
  };
}

export async function createWorkerContext({
  storedSession,
  dbPath,
  kvPath,
}: {
  storedSession: StoredSession;
  dbPath: string;
  kvPath: string;
}): Promise<{ ctx: ImportContext; agent: SessionClient }> {
  // Own DB connection (WAL + busy_timeout — safe for concurrent access)
  const { db } = createDb(dbPath);

  // Own KV storage with same mount structure as main server
  const kvDb = createSharedKvDb(kvPath);
  const kv = createStorage({
    driver: sqliteKv({ table: "kv", db: kvDb }),
  });
  kv.mount("search:", lruCacheDriver({ max: 1000 }));
  kv.mount("profile:", sqliteKv({ table: "profile", db: kvDb }));
  kv.mount("identity:", sqliteKv({ table: "identity", db: kvDb }));
  kv.mount("follows_sync:", sqliteKv({ table: "follows_sync", db: kvDb }));
  kv.mount("book_lock:", lruCacheDriver({ max: 1000 }));

  // Auth session store with pre-populated session — no KV needed for auth
  const did = storedSession.tokenSet.sub;
  const sessionStore = createInMemorySessionStore(did, storedSession);
  // KV still needed for auth_session/auth_state mounts so createOAuthClient works,
  // but the in-memory session store means restore() never hits SQLite for auth.
  const authKv = createStorage({
    driver: sqliteKv({ table: "kv", db: kvDb }),
  });
  authKv.mount("auth_session:", sqliteKv({ table: "auth_sessions", db: kvDb }));
  authKv.mount("auth_state:", sqliteKv({ table: "auth_state", db: kvDb }));

  const oauthClient = await createOAuthClient(authKv, {
    sessions: sessionStore,
    states: createNoopStateStore(),
  });
  const oauthSession = await oauthClient.restore(did as Did, { refresh: "auto" });
  const agent = sessionClientFromOAuthSession(oauthSession);

  // Service account agent (for catalog writes)
  const serviceAccountAgent =
    env.BOOKHIVE_SERVICE_HANDLE && env.BOOKHIVE_APP_PASSWORD
      ? await createServiceAccountAgent(env.BOOKHIVE_SERVICE_HANDLE, env.BOOKHIVE_APP_PASSWORD)
      : null;

  const ctx: ImportContext = {
    db,
    kv,
    serviceAccountAgent,
    addWideEventContext(context) {
      // Post observability data back to main thread for logging
      self.postMessage({ type: "wide-event", context });
    },
  };

  return { ctx, agent };
}
