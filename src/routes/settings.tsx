import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { z } from "zod";

import type { Did } from "@atcute/lexicons";
import { getSessionConfig } from "../auth/session";
import type { AppEnv, Session } from "../context";
import { Error as ErrorPage } from "../pages/error";
import { SettingsPage } from "../pages/settings";
import { deleteAccountData } from "../services/deleteAccount";
import { getAvailableLanguages } from "../data/getLanguages";
import { syncCredentialRoutes } from "./syncCredentials";

const app = new Hono<AppEnv>()
  .get("/", async (c) => {
    const agent = await c.get("ctx").getSessionAgent();
    if (!agent) return c.redirect("/login");
    const { db, kv } = c.get("ctx");
    const [profile, languages] = await Promise.all([
      c.get("ctx").getProfile(),
      getAvailableLanguages(db, kv),
    ]);
    const handle = profile?.handle ?? agent.did;
    return c.render(<SettingsPage handle={handle} languages={languages} />, {
      title: "Settings",
    });
  })
  .post(
    "/delete-account",
    zValidator("form", z.object({ confirmHandle: z.string() })),
    async (c) => {
      const agent = await c.get("ctx").getSessionAgent();
      if (!agent) {
        c.status(401);
        return c.render(
          <ErrorPage
            message="Invalid Session"
            description="Login to manage your account"
            statusCode={401}
          />,
          { title: "Unauthorized" },
        );
      }

      const { confirmHandle } = c.req.valid("form");
      const profile = await c.get("ctx").getProfile();
      const expectedHandle = profile?.handle ?? agent.did;

      if (confirmHandle !== expectedHandle) {
        c.status(400);
        return c.render(
          <ErrorPage
            message="Handle does not match"
            description="Please type your handle exactly to confirm deletion"
            statusCode={400}
          />,
          { title: "Confirmation Failed" },
        );
      }

      try {
        c.get("ctx").addWideEventContext({ account_delete: "started", userDid: agent.did });

        await deleteAccountData({ agent, db: c.get("ctx").db });

        c.get("ctx").addWideEventContext({ account_delete: "completed" });
      } catch (e) {
        c.set("requestError", e);
        c.get("ctx").addWideEventContext({
          account_delete: "failed",
          error: (e as Error).message,
        });
        c.status(500);
        return c.render(
          <ErrorPage
            message="Failed to delete account"
            description="Something went wrong while deleting your data. Please try again."
            statusCode={500}
          />,
          { title: "Error" },
        );
      }

      try {
        await c.get("ctx").oauthClient.revoke(agent.did as Did);
      } catch {
        // ignore revoke errors
      }
      const session = await getIronSession<Session>(c.req.raw, c.res, getSessionConfig());
      session.destroy();

      return c.redirect("/");
    },
  );

app.route("/sync", syncCredentialRoutes);

export default app;
