import { Hono } from "hono";

import type { AppEnv } from "../context";
import { currentSyncPassword, rotateSyncToken } from "../middleware/sync-auth";
import { jsonUnauthorized } from "./authResponse";

/**
 * The KOSync/OPDS derived password, read and rotated.
 *
 * Mounted at **both** `/settings/sync` and `/library/sync` — the iOS app uses
 * the first, the web library the second — replacing what used to be two
 * byte-identical copies kept in step by hand.
 */
export const syncCredentialRoutes = new Hono<AppEnv>()
  .get("/password", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return jsonUnauthorized(c);
    const password = await currentSyncPassword(c.get("ctx").kv, agent.did);
    return c.json({ password });
  })
  .post("/rotate", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return jsonUnauthorized(c);
    await rotateSyncToken(c.get("ctx").kv, agent.did);
    const password = await currentSyncPassword(c.get("ctx").kv, agent.did);
    return c.json({ password });
  });
