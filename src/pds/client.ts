import { Client, simpleFetchHandler } from "@atcute/client";
import type { FetchHandler } from "@atcute/client";
// Import to activate ambient XRPCProcedures type augmentations for com.atproto.*
import "@atcute/atproto";
import type { Did, Handle } from "@atcute/lexicons";
import { env } from "../env";

export function isPdsEnabled(): boolean {
  return env.PDS_URL !== "" && env.PDS_ADMIN_PASSWORD !== "";
}

// Idea from https://self.surf/how-it-works

function makePdsClient(auth?: string): Client {
  const base = simpleFetchHandler({ service: env.PDS_URL });
  const handler: FetchHandler = auth
    ? (pathname, init) => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", auth);
        return base(pathname, { ...init, headers });
      }
    : base;
  return new Client({ handler });
}

export async function listRepos(): Promise<string[]> {
  const client = makePdsClient();
  const dids: string[] = [];
  let cursor: string | undefined;

  do {
    const res = await client.get("com.atproto.sync.listRepos", {
      params: { limit: 1000, cursor },
    });
    if (!res.ok) break;
    for (const repo of res.data.repos) {
      if (repo.active !== false) {
        dids.push(repo.did);
      }
    }
    cursor = res.data.cursor;
  } while (cursor);

  return dids;
}

export async function mintInviteCode(): Promise<string> {
  const client = makePdsClient(`Basic ${btoa(`admin:${env.PDS_ADMIN_PASSWORD}`)}`);
  const res = await client.post("com.atproto.server.createInviteCode", {
    input: { useCount: 1 },
  });
  if (!res.ok) {
    throw new Error(`Failed to mint invite code: ${res.data.message ?? res.data.error}`);
  }
  return res.data.code;
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
  const client = makePdsClient();
  const res = await client.post("com.atproto.server.createAccount", {
    input: {
      email: opts.email,
      handle: opts.handle as Handle,
      password: opts.password,
      inviteCode: opts.inviteCode,
    },
  });
  if (!res.ok) {
    if (res.data.error === "InvalidHandle" || res.data.error === "HandleNotAvailable") {
      throw new Error("This handle is already taken or invalid.");
    }
    throw new Error(`Failed to create account: ${res.data.message ?? res.data.error}`);
  }
  return {
    did: res.data.did,
    handle: res.data.handle,
    accessJwt: res.data.accessJwt,
    refreshJwt: res.data.refreshJwt,
  };
}

export type BlobRef = {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
};

export async function uploadBlob(
  accessJwt: string,
  data: Blob,
  mimeType: string,
): Promise<BlobRef> {
  const client = makePdsClient(`Bearer ${accessJwt}`);
  const blob = data.type === mimeType ? data : new Blob([data], { type: mimeType });
  const res = await client.post("com.atproto.repo.uploadBlob", {
    input: blob,
    headers: { "content-type": mimeType },
  });
  if (!res.ok) {
    throw new Error(`Failed to upload avatar: ${res.data.message ?? res.data.error}`);
  }
  return res.data.blob as BlobRef;
}

export async function createEmptyProfile(
  accessJwt: string,
  did: string,
  avatar?: BlobRef,
): Promise<void> {
  const client = makePdsClient(`Bearer ${accessJwt}`);
  const res = await client.post("com.atproto.repo.putRecord", {
    input: {
      repo: did as Did,
      collection: "app.bsky.actor.profile",
      rkey: "self",
      record: {
        $type: "app.bsky.actor.profile",
        ...(avatar ? { avatar } : {}),
      },
    },
  });
  if (!res.ok) {
    // Non-fatal: profile creation failing shouldn't block account creation
    console.error("Failed to create empty profile:", res.data.message ?? res.data.error);
  }
}
