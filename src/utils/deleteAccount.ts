import type { SessionClient } from "../auth/client";
import { ids } from "../bsky/lexicon";
import type { Database } from "../db";

type ListRecordsOut = {
  records: Array<{ uri: string; cid: string; value: unknown }>;
  cursor?: string;
};

const PDS_BATCH_LIMIT = 200;

async function listAllRecordUris(agent: SessionClient, collection: string): Promise<string[]> {
  const uris: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await agent.get("com.atproto.repo.listRecords", {
      params: { repo: agent.did, collection, limit: 100, cursor },
    });
    if (!res.ok) break;
    const data = res.data as ListRecordsOut;
    for (const record of data.records) {
      uris.push(record.uri);
    }
    cursor = data.records.length === 100 ? data.cursor : undefined;
  } while (cursor);
  return uris;
}

async function batchDeleteFromPds(
  agent: SessionClient,
  collection: string,
  uris: string[],
): Promise<void> {
  const writes = uris.map((uri) => ({
    $type: "com.atproto.repo.applyWrites#delete" as const,
    collection,
    rkey: uri.split("/").at(-1)!,
  }));

  for (let i = 0; i < writes.length; i += PDS_BATCH_LIMIT) {
    const res = await agent.post("com.atproto.repo.applyWrites", {
      input: { repo: agent.did, writes: writes.slice(i, i + PDS_BATCH_LIMIT) },
    });
    if (!res.ok) throw new Error(`Failed to delete ${collection} records from PDS`);
  }
}

/** Delete all BookHive data for a user from both PDS and local database. */
export async function deleteAccountData({
  agent,
  db,
}: {
  agent: SessionClient;
  db: Database;
}): Promise<void> {
  // PDS cleanup first (order: items before parents)
  const collections = [
    ids.SocialPopfeedFeedListItem,
    ids.SocialPopfeedFeedList,
    ids.BuzzBookhiveBuzz,
    ids.BuzzBookhiveBook,
  ];

  for (const collection of collections) {
    const uris = await listAllRecordUris(agent, collection);
    if (uris.length > 0) {
      await batchDeleteFromPds(agent, collection, uris);
    }
  }

  // DB cleanup
  const did = agent.did;
  await db.deleteFrom("book_list_item").where("userDid", "=", did).execute();
  await db.deleteFrom("book_list").where("userDid", "=", did).execute();
  await db.deleteFrom("buzz").where("userDid", "=", did).execute();
  await db.deleteFrom("user_book").where("userDid", "=", did).execute();
  await db.deleteFrom("user_follows").where("userDid", "=", did).execute();
}
