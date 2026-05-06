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
import pgKv from "../../pg-kv";
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
  databaseUrl,
}: {
  storedSession: StoredSession;
  databaseUrl: string;
}): Promise<{ ctx: ImportContext; agent: SessionClient }> {
  // Own DB connection pool (workers can't share pools across threads)
  const { db, pool } = createDb(databaseUrl);

  // Own KV storage with same mount structure as main server
  const kv = createStorage({
    driver: pgKv({ table: "kv", pool }),
  });
  kv.mount("search:", lruCacheDriver({ max: 1000 }));
  kv.mount("profile:", pgKv({ table: "kv_profile", pool }));
  kv.mount("identity:", pgKv({ table: "kv_identity", pool }));
  kv.mount("follows_sync:", pgKv({ table: "kv_follows_sync", pool }));
  kv.mount("book_lock:", lruCacheDriver({ max: 1000 }));

  // Auth session store with pre-populated session — no KV needed for auth
  const did = storedSession.tokenSet.sub;
  const sessionStore = createInMemorySessionStore(did, storedSession);
  // KV still needed for auth_session/auth_state mounts so createOAuthClient works,
  // but the in-memory session store means restore() never hits PostgreSQL for auth.
  const authKv = createStorage({
    driver: pgKv({ table: "kv", pool }),
  });
  authKv.mount("auth_session:", pgKv({ table: "kv_auth_sessions", pool }));
  authKv.mount("auth_state:", pgKv({ table: "kv_auth_state", pool }));

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
