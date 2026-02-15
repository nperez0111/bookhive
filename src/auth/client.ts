import { Client } from "@atcute/client";
import type { OAuthSession } from "@atcute/oauth-node-client";
import { OAuthClient } from "@atcute/oauth-node-client";
import { createActorResolver } from "../bsky/id-resolver";
import { env } from "../env";
import { createSessionStore, createStateStore } from "./storage";
import type { Storage } from "unstorage";

const time = Date.now();

// OAuth scopes required for BookHive operations:
// - atproto: Base scope required for AT Protocol authentication
// - blob:*/*: Required for uploading book cover images
// - repo:buzz.bookhive.book: Write operations on book records (create, update, delete)
// - repo:buzz.bookhive.buzz: Write operations on comment records (create, update, delete)
// - repo:app.bsky.graph.follow: Create follow records (for following users)
// - rpc:app.bsky.graph.getFollows: Required for fetching user's follows list from any Audience
// - rpc:app.bsky.actor.getProfile: Required for fetching user profile information from any Audience
export const OAUTH_SCOPES =
  "atproto blob:*/* repo:buzz.bookhive.book?action=create&action=update&action=delete repo:buzz.bookhive.buzz?action=create&action=update&action=delete repo:app.bsky.graph.follow?action=create rpc:app.bsky.graph.getFollows?aud=* rpc:app.bsky.actor.getProfile?aud=* rpc:app.bsky.actor.getProfiles?aud=*";

export async function createOAuthClient(kv: Storage) {
  const publicUrl = env.PUBLIC_URL;
  const baseUrl = publicUrl || `http://127.0.0.1:${env.PORT}`;
  const isLoopback = !publicUrl;
  const redirectUris = isLoopback
    ? [`http://127.0.0.1:${env.PORT}/oauth/callback`]
    : [`${baseUrl}/oauth/callback`];

  return new OAuthClient({
    metadata: {
      ...(isLoopback
        ? {}
        : { client_id: `${baseUrl}/oauth-client-metadata.json` }),
      redirect_uris: redirectUris,
      scope: OAUTH_SCOPES,
      ...(isLoopback
        ? {}
        : {
            client_uri: baseUrl,
            client_name: "BookHive",
            logo_uri: `${baseUrl}/public/full_logo.jpg`,
            policy_uri: `${baseUrl}/privacy-policy`,
          }),
    },
    actorResolver: createActorResolver(),
    stores: {
      sessions: createSessionStore(kv),
      states: createStateStore(kv),
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
          setTimeout(
            () => waitForLock(key, cb, attempt + 1).then(resolve, reject),
            100,
          ),
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
    | { ok: true; data: unknown }
    | { ok: false; data: { error: string; message?: string } }
  >;
  post: (
    name: string,
    opts?: Record<string, unknown>,
  ) => Promise<
    | { ok: true; data: unknown }
    | { ok: false; data: { error: string; message?: string } }
  >;
};

export function sessionClientFromOAuthSession(
  session: OAuthSession,
): SessionClient {
  const client = new Client({ handler: session });
  return {
    get did() {
      return session.did;
    },
    get: client.get.bind(client) as SessionClient["get"],
    post: client.post.bind(client) as SessionClient["post"],
  };
}
