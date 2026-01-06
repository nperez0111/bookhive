import { NodeOAuthClient } from "@atproto/oauth-client-node";
import { env } from "../env";
import { SessionStore, StateStore } from "./storage";
import type { Storage } from "unstorage";

const time = Date.now();

// OAuth scopes required for BookHive operations:
// - atproto: Base scope required for AT Protocol authentication
// - blob:*/*: Required for uploading book cover images
// - repo:buzz.bookhive.book: Write operations on book records (create, update, delete)
//   Note: Reading records doesn't require a permission per AT Protocol spec
// - repo:buzz.bookhive.buzz: Write operations on comment records (create, update, delete)
// - repo:app.bsky.graph.follow: Create follow records (for following users)
// - rpc:app.bsky.graph.getFollows: Required for fetching user's follows list from any Audience
// - rpc:app.bsky.actor.getProfile: Required for fetching user profile information from any Audience
export const OAUTH_SCOPES =
  "atproto blob:*/* repo:buzz.bookhive.book?action=create&action=update&action=delete repo:buzz.bookhive.buzz?action=create&action=update&action=delete repo:app.bsky.graph.follow?action=create rpc:app.bsky.graph.getFollows?aud=* rpc:app.bsky.actor.getProfile?aud=* rpc:app.bsky.actor.getProfiles?aud=*";

export const createClient = async (kv: Storage) => {
  const publicUrl = env.PUBLIC_URL;
  const url = publicUrl || `http://127.0.0.1:${env.PORT}`;
  const enc = encodeURIComponent;
  return new NodeOAuthClient({
    clientMetadata: {
      client_name: "BookHive",
      client_id: publicUrl
        ? `${url}/oauth-client-metadata.json`
        : `http://localhost?redirect_uri=${enc(`${url}/oauth/callback`)}&scope=${enc(OAUTH_SCOPES)}`,
      client_uri: url,
      redirect_uris: [`${url}/oauth/callback`],
      scope: OAUTH_SCOPES,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
      logo_uri: `${url}/public/full_logo.jpg`,
      policy_uri: `${url}/privacy-policy`,
    },
    stateStore: new StateStore(kv),
    sessionStore: new SessionStore(kv),
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
        // Check again in 100ms
        return new Promise((resolve, reject) =>
          setTimeout(
            () => waitForLock(key, cb, attempt++).then(resolve, reject),
            100,
          ),
        );
      }

      // If we get here, the lock is ours
      return cb();
    },
  });
};
