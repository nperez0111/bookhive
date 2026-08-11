/**
 * "Has this DID ever used BookHive?"
 *
 * This exists for service auth and nothing else. A valid inter-service JWT
 * proves the caller controls an atproto identity — it says nothing about
 * whether that identity has any relationship with us. Without a gate here, any
 * DID on the network could authenticate and start filling a 2 GB library on our
 * disk.
 *
 * The other credentialled surfaces get this implicitly: OPDS and KOSync derive
 * their password from `COOKIE_SECRET`, so the only way to learn it is to have
 * signed in and read it off the settings page. Service auth has no such
 * property, so the check has to be explicit.
 *
 * There is no accounts table (see `DatabaseSchema`), so this is a KV marker
 * written at sign-in, plus a one-time probe of the durable traces an existing
 * account leaves — every user predates the marker.
 */

import type { Storage } from "unstorage";
import type { Database } from "../db";

const ACCOUNT_PREFIX = "account:";

/** Record that a DID has signed in. Called from the OAuth callback. */
export async function markAccount(kv: Storage, did: string): Promise<void> {
  await kv.setItem(`${ACCOUNT_PREFIX}${did}`, 1);
}

/**
 * Marker first; on a miss, backfill from any durable trace of the account. The
 * result is memoised permanently — this is not a fact that can become false —
 * so the four-way probe runs at most once per DID.
 */
export async function isKnownAccount(
  deps: { db: Database; kv: Storage },
  did: string,
): Promise<boolean> {
  const key = `${ACCOUNT_PREFIX}${did}`;
  if (await deps.kv.hasItem(key)) return true;

  // All four are indexed on userDid (or are a direct KV key lookup).
  const [session, userBook, personalBook, syncDoc] = await Promise.all([
    deps.kv.hasItem(`auth_session:${did}`),
    deps.db
      .selectFrom("user_book")
      .select("uri")
      .where("userDid", "=", did)
      .limit(1)
      .executeTakeFirst(),
    deps.db
      .selectFrom("personal_book")
      .select("id")
      .where("userDid", "=", did)
      .limit(1)
      .executeTakeFirst(),
    deps.db
      .selectFrom("sync_document")
      .select("id")
      .where("userDid", "=", did)
      .limit(1)
      .executeTakeFirst(),
  ]);

  if (!session && !userBook && !personalBook && !syncDoc) return false;

  await markAccount(deps.kv, did);
  return true;
}
