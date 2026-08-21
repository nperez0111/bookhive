/**
 * CAS read/write of a book record. The merge is computed from local state, so
 * the write must fail if the PDS holds something we have not seen.
 * `applyWrites` only offers `swapCommit` (whole repo, fails on any unrelated
 * write), hence `putRecord`.
 */
import type { SessionClient } from "../auth/client";
import { ids, Book as BookRecord } from "../bsky/lexicon";
import type { BookRecordValue } from "../types";

/** Current record on the PDS. Not pinned to a cid: a stale pin 404s and looked like "no record". */
export async function getBookRecord({
  agent,
  uri,
}: {
  agent: Pick<SessionClient, "did" | "get">;
  uri: string;
}): Promise<{ value: BookRecordValue; cid: string } | null> {
  const res = await agent.get("com.atproto.repo.getRecord", {
    params: {
      repo: agent.did,
      collection: ids.BuzzBookhiveBook,
      rkey: uri.split("/").at(-1)!,
    },
  });
  const payload = res.ok ? (res.data as { value?: unknown; cid?: string }) : null;
  // A cid is required: there is nothing to compare-and-swap on without one.
  if (!payload?.value || !payload.cid) return null;
  // A record failing our validator is still the user's record; merging onto it
  // is how the offending field gets overwritten. Refusing bricks the book.
  const parsed = BookRecord.validateRecord(payload.value);
  return {
    value: (parsed.success ? parsed.value : payload.value) as BookRecordValue,
    cid: payload.cid,
  };
}

export type BookRecordWriteResult =
  | { ok: true; uri: string; cid: string }
  | { ok: false; error: string; message?: string };

/** The PDS's error name when `swapRecord` does not match the current CID. */
export const INVALID_SWAP = "InvalidSwap";

export async function writeBookRecord({
  agent,
  rkey,
  record,
  swapRecord,
}: {
  agent: Pick<SessionClient, "did" | "post">;
  rkey: string;
  record: BookRecordValue;
  /** CID the record must still have; `null` creates. There is deliberately no "don't check". */
  swapRecord: string | null;
}): Promise<BookRecordWriteResult> {
  const response =
    swapRecord === null
      ? await agent.post("com.atproto.repo.createRecord", {
          input: {
            repo: agent.did,
            collection: ids.BuzzBookhiveBook,
            rkey,
            record,
          },
        })
      : await agent.post("com.atproto.repo.putRecord", {
          input: {
            repo: agent.did,
            collection: ids.BuzzBookhiveBook,
            rkey,
            record,
            swapRecord,
          },
        });

  if (!response.ok) {
    return { ok: false, error: response.data.error, message: response.data.message };
  }
  const data = response.data as { uri?: string; cid?: string };
  if (!data.uri || !data.cid) {
    return { ok: false, error: "MalformedResponse", message: "PDS returned no uri/cid" };
  }
  return { ok: true, uri: data.uri, cid: data.cid };
}
