import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context";
import { currentSyncPassword, timingSafeEqualString } from "./sync-auth";

export const opdsAuthMiddleware = createMiddleware<AppEnv & { Variables: { opdsUserDid: string } }>(
  async (c, next) => {
    const { baseIdResolver, kv, addWideEventContext } = c.get("ctx");

    const unauthorized = () =>
      new Response("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="BookHive OPDS"' },
      });

    const header = c.req.header("authorization") || "";
    const match = header.match(/^Basic\s+(.+)$/i);
    if (!match) return unauthorized();

    let decoded: string;
    try {
      decoded = Buffer.from(match[1]!, "base64").toString("utf-8");
    } catch {
      return unauthorized();
    }

    const sep = decoded.indexOf(":");
    if (sep === -1) return unauthorized();

    const handle = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);
    if (!handle || !password) return unauthorized();

    let did: string;
    try {
      did = await baseIdResolver.handle.resolve(handle);
    } catch {
      addWideEventContext({ opds_auth: "resolve_failed", opds_auth_user: handle });
      return unauthorized();
    }

    const expected = await currentSyncPassword(kv, did);

    if (!timingSafeEqualString(password, expected)) {
      addWideEventContext({
        opds_auth: "password_mismatch",
        opds_auth_user: handle,
        opds_auth_did: did,
      });
      return unauthorized();
    }

    c.set("opdsUserDid", did);
    return next();
  },
);
