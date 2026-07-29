import crypto from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Storage } from "unstorage";
import { env } from "../env";
import type { AppEnv } from "../context";

/**
 * Per-user rotation counter for the KOSync password. Stored as a plain integer
 * in KV (`sync_token:{did}`), defaulting to 0. Incrementing it changes the
 * derived password, letting a user invalidate a token they revealed by
 * accident without touching the global COOKIE_SECRET.
 */
export async function getSyncTokenVersion(kv: Storage, did: string): Promise<number> {
  return (await kv.getItem<number>(`sync_token:${did}`)) ?? 0;
}

export async function rotateSyncToken(kv: Storage, did: string): Promise<number> {
  const next = (await getSyncTokenVersion(kv, did)) + 1;
  await kv.setItem(`sync_token:${did}`, next);
  return next;
}

// A short, high-entropy alphabet for the displayed password. Ambiguous glyphs
// (0/O, 1/l/I) are omitted; a few symbols widen the alphabet so we can stay
// short. 10 chars over this 66-char set is ~60 bits — far more than enough for
// an online-only credential.
const SYNC_PASSWORD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz!@#$%*+-=?";
const SYNC_PASSWORD_LENGTH = 10;

/**
 * Deterministically derive the KOSync password shown to the user. Uses
 * HMAC-SHA256 (keyed by the server secret) over `${did}:${version}` so the
 * server can re-derive and display it, while a rotation bump changes the value.
 * The digest bytes are encoded to a short mixed alphabet for easier entry on an
 * e-reader keyboard.
 */
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

    // KOReader sends md5(password), so compare against the md5 of the derived value.
    const expected = md5Hex(await currentSyncPassword(kv, did));

    if (!timingSafeEqualString(password, expected)) {
      // Most common cause: the username entered on the device resolves to a
      // different DID than the account whose password was copied from Settings.
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
