import { NodeOAuthClient } from "@atproto/oauth-client-node";
import { env } from "../env";
import { SessionStore, StateStore } from "./storage";
import type { Storage } from "unstorage";

const time = Date.now();

export const createClient = async (kv: Storage) => {
  const publicUrl = env.PUBLIC_URL;
  const url = publicUrl || `http://127.0.0.1:${env.PORT}`;
  const enc = encodeURIComponent;
  return new NodeOAuthClient({
    clientMetadata: {
      client_name: "BookHive",
      client_id: publicUrl
        ? `${url}/client-metadata.json`
        : `http://localhost?redirect_uri=${enc(`${url}/oauth/callback`)}&scope=${enc("atproto transition:generic")}`,
      client_uri: url,
      redirect_uris: [`${url}/oauth/callback`],
      scope: "atproto transition:generic",
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
