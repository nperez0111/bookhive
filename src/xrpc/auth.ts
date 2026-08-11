/**
 * Authentication for `/xrpc/*`.
 *
 * Two credentials are accepted:
 *
 * - The `sid` iron-session cookie, which is what the web app and the iOS app
 *   have always used.
 * - An **atproto inter-service auth JWT** as `Authorization: Bearer <token>` —
 *   https://atproto.com/specs/xrpc#inter-service-authentication-jwt. The client
 *   asks its own PDS for a token via `com.atproto.server.getServiceAuth`,
 *   bound to an audience (us) and an `lxm` (the one method it wants to call);
 *   the PDS signs it with the account's repo signing key, and we verify it by
 *   resolving the issuer's DID document. This is the canonical mechanism for a
 *   third-party service exposing its own XRPC methods, and it is what makes the
 *   personal library reachable from a script or an e-reader rather than only
 *   from a browser session.
 *
 * The one thing service auth cannot do is write to the user's repo: it proves
 * control of a signing key, not that we hold an OAuth grant for that account.
 * `AuthMode` is how a method declares which it needs.
 */

import { AuthRequiredError } from "@atcute/xrpc-server";
import type { ServiceJwtVerifier } from "@atcute/xrpc-server/auth";
import type { Nsid } from "@atcute/lexicons";
import type { SessionClient } from "../auth/client";

/**
 * What a method requires of its caller.
 *
 * `identity` — we only need to know *who* they are. Every personal-library and
 *   sync method is in this class: none of them touch the session agent for
 *   anything but `.did` (progress bridging writes `user_book` and queues a
 *   deferred PDS write via `sync_pending:`, rather than writing inline).
 * `pdsWrite` — the handler puts a record in the user's repository, which needs
 *   a live OAuth session. Only the book-list procedures are in this class.
 */
export type AuthMode = "identity" | "pdsWrite";

export type XrpcAuth =
  | { did: string; method: "session"; agent: SessionClient }
  | { did: string; method: "service"; agent: null };

export type XrpcAuthContext = {
  getSessionAgent: () => Promise<SessionClient | null>;
  serviceJwtVerifier?: ServiceJwtVerifier | null;
  isKnownAccount?: (did: string) => Promise<boolean>;
};

export async function resolveXrpcAuth(
  ctx: XrpcAuthContext,
  request: Request,
  opts: { lxm: Nsid; mode: AuthMode },
): Promise<XrpcAuth> {
  const authorization = request.headers.get("authorization");

  // Bearer wins when both are somehow present: a browser never sends one and a
  // programmatic client never has our cookie, so a request carrying both is
  // stating its intent.
  if (authorization !== null && /^bearer\s/i.test(authorization)) {
    if (!ctx.serviceJwtVerifier) {
      throw new AuthRequiredError({ message: "Service auth is not enabled on this server" });
    }
    if (opts.mode === "pdsWrite") {
      throw new AuthRequiredError({
        message:
          `${opts.lxm} writes a record to your repository, which needs an OAuth session; ` +
          `service auth cannot provide one. Sign in at bookhive.buzz to use this method.`,
      });
    }

    // Throws AuthRequiredError (401, with a WWW-Authenticate: Bearer challenge)
    // on every failure path: missing or malformed token, bad signature, wrong
    // audience, wrong lxm, expired, outside the max-age window, or replayed.
    const { issuer } = await ctx.serviceJwtVerifier.verifyRequest(request, { lxm: opts.lxm });

    // A valid token proves control of an atproto identity, not that the
    // identity has ever used BookHive. Without this gate any DID on the network
    // could open a storage quota's worth of space on our disk.
    if (ctx.isKnownAccount && !(await ctx.isKnownAccount(issuer))) {
      throw new AuthRequiredError({
        message: "No BookHive account for this DID — sign in at bookhive.buzz once first",
      });
    }

    return { did: issuer, method: "service", agent: null };
  }

  const agent = await ctx.getSessionAgent();
  if (!agent) throw new AuthRequiredError({ message: "Authentication required" });
  return { did: agent.did, method: "session", agent };
}
