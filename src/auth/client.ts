import { Client } from "@atcute/client";
import type { OAuthSession, SessionStore, StateStore } from "@atcute/oauth-node-client";
import { OAuthClient } from "@atcute/oauth-node-client";
import { createActorResolver } from "../bsky/id-resolver";
import { env } from "../env";
import { createSessionStore, createStateStore } from "./storage";
import type { Storage } from "unstorage";

const time = Date.now();

// Toggle to use permission-set scopes (requires PDS support for permission sets).
// When true, uses the bundled `include:buzz.bookhive.auth` scope.
// When false, uses the granular per-resource scopes (works on all current PDS instances).
const USE_PERMISSION_SETS = true;

const GRANULAR_SCOPES =
  "atproto blob:*/* repo:buzz.bookhive.book?action=create&action=update&action=delete repo:buzz.bookhive.buzz?action=create&action=update&action=delete repo:app.bsky.graph.follow?action=create&action=delete repo:social.popfeed.feed.list?action=create&action=update&action=delete repo:social.popfeed.feed.listItem?action=create&action=update&action=delete rpc:app.bsky.graph.getFollows?aud=* rpc:app.bsky.actor.getProfile?aud=* rpc:app.bsky.actor.getProfiles?aud=*";

// Permission set can only cover buzz.bookhive.* namespace (spec namespace authority rule).
// blob, app.bsky.*, and social.popfeed.* must remain as granular scopes.
const PERMISSION_SET_SCOPES =
  "atproto include:buzz.bookhive.auth blob:*/* repo:app.bsky.graph.follow?action=create&action=delete repo:social.popfeed.feed.list?action=create&action=update&action=delete repo:social.popfeed.feed.listItem?action=create&action=update&action=delete rpc:app.bsky.graph.getFollows?aud=* rpc:app.bsky.actor.getProfile?aud=* rpc:app.bsky.actor.getProfiles?aud=*";

export const OAUTH_SCOPES = USE_PERMISSION_SETS ? PERMISSION_SET_SCOPES : GRANULAR_SCOPES;

export async function createOAuthClient(
  kv: Storage,
  storeOverrides?: { sessions: SessionStore; states: StateStore },
) {
  const publicUrl = env.PUBLIC_URL;
  const baseUrl = publicUrl || `http://127.0.0.1:${env.PORT}`;
  const isLoopback =
    !publicUrl || publicUrl.includes("127.0.0.1") || publicUrl.includes("localhost");
  const redirectUris = [`${baseUrl}/oauth/callback`];

  return new OAuthClient({
    metadata: {
      ...(isLoopback ? {} : { client_id: `${baseUrl}/oauth-client-metadata.json` }),
      redirect_uris: redirectUris,
      scope: OAUTH_SCOPES,
      ...(isLoopback
        ? {}
        : {
            client_uri: baseUrl,
            client_name: "BookHive",
            logo_uri: `${baseUrl}/full_logo.jpg`,
            policy_uri: `${baseUrl}/privacy-policy`,
          }),
    },
    actorResolver: createActorResolver(),
    stores: {
      sessions: storeOverrides?.sessions ?? createSessionStore(kv),
      states: storeOverrides?.states ?? createStateStore(kv),
    },
    requestLock: async function waitForLock(key, cb, attempt = 0) {
      if (attempt > 10) {
        throw new Error(`Lock timeout for ${key}`);
      }
      const lock = await kv.get<number>(`auth_lock:${key}`);
      if (!lock) {
        try {
          await kv.set(`auth_lock:${key}`, time);
          return cb();
        } finally {
          await kv.del(`auth_lock:${key}`);
        }
      }
      if (lock !== time) {
        return new Promise((resolve, reject) =>
          setTimeout(() => waitForLock(key, cb, attempt + 1).then(resolve, reject), 100),
        );
      }
      return cb();
    },
  });
}

/** Session-scoped XRPC client with .did (for use where Agent was used). */
export type SessionClient = {
  did: string;
  get: (
    name: string,
    opts?: Record<string, unknown>,
  ) => Promise<
    { ok: true; data: unknown } | { ok: false; data: { error: string; message?: string } }
  >;
  post: (
    name: string,
    opts?: Record<string, unknown>,
  ) => Promise<
    { ok: true; data: unknown } | { ok: false; data: { error: string; message?: string } }
  >;
};

export function sessionClientFromOAuthSession(session: OAuthSession): SessionClient {
  const client = new Client({ handler: session });
  return {
    get did() {
      return session.did;
    },
    get: client.get.bind(client) as SessionClient["get"],
    post: client.post.bind(client) as SessionClient["post"],
  };
}
