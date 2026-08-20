/**
 * CAS write of a book record. The merge is computed from local state, so the
 * write must fail if the PDS holds something we have not seen. `applyWrites`
 * only offers `swapCommit` (whole repo, fails on any unrelated write), hence
 * `putRecord`.
 */
import type { SessionClient } from "../auth/client";
import { ids } from "../bsky/lexicon";
import type { BookRecordValue } from "../types";

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
