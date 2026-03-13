import { env } from "../env";

export function isPdsEnabled(): boolean {
  return env.PDS_URL !== "" && env.PDS_ADMIN_PASSWORD !== "";
}

// Idea from https://self.surf/how-it-works

export async function mintInviteCode(): Promise<string> {
  const res = await fetch(`${env.PDS_URL}/xrpc/com.atproto.server.createInviteCode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`admin:${env.PDS_ADMIN_PASSWORD}`)}`,
    },
    body: JSON.stringify({ useCount: 1 }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Failed to mint invite code: ${(body as { message?: string }).message ?? res.statusText}`);
  }

  const data = (await res.json()) as { code: string };
  return data.code;
}

export type CreateAccountResult = {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
};

export async function createAccount(opts: {
  email: string;
  handle: string;
  password: string;
  inviteCode: string;
}): Promise<CreateAccountResult> {
  const res = await fetch(`${env.PDS_URL}/xrpc/com.atproto.server.createAccount`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: opts.email,
      handle: opts.handle,
      password: opts.password,
      inviteCode: opts.inviteCode,
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    if (body.error === "InvalidHandle" || body.error === "HandleNotAvailable") {
      throw new Error("This handle is already taken or invalid.");
    }
    throw new Error(`Failed to create account: ${body.message ?? res.statusText}`);
  }

  return (await res.json()) as CreateAccountResult;
}

export async function createEmptyProfile(accessJwt: string, did: string): Promise<void> {
  const res = await fetch(`${env.PDS_URL}/xrpc/com.atproto.repo.putRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessJwt}`,
    },
    body: JSON.stringify({
      repo: did,
      collection: "app.bsky.actor.profile",
      rkey: "self",
      record: {
        $type: "app.bsky.actor.profile",
      },
    }),
  });

  if (!res.ok) {
    // Non-fatal: profile creation failing shouldn't block account creation
    console.error("Failed to create empty profile:", await res.text().catch(() => "unknown"));
  }
}
