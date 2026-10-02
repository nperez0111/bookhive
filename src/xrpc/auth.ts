/**
 * Authentication for `/xrpc/*`.
 *
 * Accepts the `sid` iron-session cookie (web + iOS), or an atproto
 * inter-service auth JWT as `Authorization: Bearer <token>` — see
 * https://atproto.com/specs/xrpc#inter-service-authentication-jwt — which is
 * what makes the personal library reachable from a script or e-reader.
 * Service auth proves control of a signing key, not an OAuth grant, so it can
 * never satisfy a `pdsWrite` method; `AuthMode` is how a method declares
 * which it needs.
 */

import { AuthRequiredError } from "@atcute/xrpc-server";
import type { ServiceJwtVerifier } from "@atcute/xrpc-server/auth";
import type { Nsid } from "@atcute/lexicons";
import type { SessionClient } from "../auth/client";

/**
 * What a method requires of its caller.
 *
 * `identity` — only the caller's DID is needed (personal-library and sync methods).
 * `pdsWrite` — the handler writes to the user's repo, so it needs a live OAuth session (book-list procedures only).
 */
export type AuthMode = "identity" | "pdsWrite";

export type XrpcAuth =
  | { did: string; method: "session"; agent: SessionClient }
  | { did: string; method: "service"; agent: null };

export type XrpcAuthContext = {
  getSessionAgent: () => Promise<SessionClient | null>;
  serviceJwtVerifier?: ServiceJwtVerifier | null;
};

export async function resolveXrpcAuth(
  ctx: XrpcAuthContext,
  request: Request,
  opts: { lxm: Nsid; mode: AuthMode },
): Promise<XrpcAuth> {
  const authorization = request.headers.get("authorization");

  // Bearer wins when both are present — a browser never sends one and a
  // programmatic client never has our cookie.
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

    // Throws AuthRequiredError (401) on any failure: bad/missing token, wrong
    // audience/lxm, expired, or replayed.
    //
    // Any DID on the network is accepted — the per-user storage quota is the
    // deliberate backstop, not prior sign-in.
    const { issuer } = await ctx.serviceJwtVerifier.verifyRequest(request, { lxm: opts.lxm });

    return { did: issuer, method: "service", agent: null };
  }

  const agent = await ctx.getSessionAgent();
  if (!agent) throw new AuthRequiredError({ message: "Authentication required" });
  return { did: agent.did, method: "session", agent };
}
