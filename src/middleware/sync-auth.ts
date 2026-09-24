import crypto from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Storage } from "unstorage";
import { env } from "../env";
import type { AppEnv } from "../context";

// Per-user rotation counter for the KOSync password; incrementing it changes the derived password without touching the global COOKIE_SECRET.
export async function getSyncTokenVersion(kv: Storage, did: string): Promise<number> {
  return (await kv.getItem<number>(`sync_token:${did}`)) ?? 0;
}

export async function rotateSyncToken(kv: Storage, did: string): Promise<number> {
  const next = (await getSyncTokenVersion(kv, did)) + 1;
  await kv.setItem(`sync_token:${did}`, next);
  return next;
}

// High-entropy alphabet for the displayed password, with ambiguous glyphs (0/O, 1/l/I) omitted for easier manual entry.
const SYNC_PASSWORD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz!@#$%*+-=?";
const SYNC_PASSWORD_LENGTH = 10;

// Deterministically derives the KOSync password from HMAC-SHA256(secret, `${did}:${version}`), so the server can re-derive and display it without storing it.
export function deriveSyncPassword(did: string, secret: string, version: number): string {
  const digest = new Bun.CryptoHasher("sha256", secret).update(`${did}:${version}`).digest();
  let out = "";
  for (let i = 0; i < SYNC_PASSWORD_LENGTH; i++) {
    out += SYNC_PASSWORD_ALPHABET[digest[i]! % SYNC_PASSWORD_ALPHABET.length];
  }
  return out;
}

/** Current plaintext password for a user (reads the rotation counter). */
export async function currentSyncPassword(kv: Storage, did: string): Promise<string> {
  const version = await getSyncTokenVersion(kv, did);
  return deriveSyncPassword(did, env.COOKIE_SECRET, version);
}

/** KOReader transmits `md5(password)` as `x-auth-key`, so we compare against that. */
function md5Hex(value: string): string {
  return new Bun.CryptoHasher("md5").update(value).digest("hex");
}

export const syncAuthMiddleware = createMiddleware<AppEnv & { Variables: { syncUserDid: string } }>(
  async (c, next) => {
    const username = c.req.header("x-auth-user");
    const password = c.req.header("x-auth-key");

    if (!username || !password) {
      return c.json({ message: "Authentication required" }, 401);
    }

    const { baseIdResolver, kv, addWideEventContext } = c.get("ctx");

    let did: string;
    try {
      did = await baseIdResolver.handle.resolve(username);
    } catch {
      addWideEventContext({ sync_auth: "resolve_failed", sync_auth_user: username });
      return c.json({ message: "Invalid credentials" }, 401);
    }

    const expected = md5Hex(await currentSyncPassword(kv, did));

    if (!timingSafeEqualString(password, expected)) {
      // Most common cause: the device's username resolves to a different DID than the account the password was copied from.
      addWideEventContext({
        sync_auth: "password_mismatch",
        sync_auth_user: username,
        sync_auth_did: did,
      });
      return c.json({ message: "Invalid credentials" }, 401);
    }

    c.set("syncUserDid", did);
    return next();
  },
);

export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
