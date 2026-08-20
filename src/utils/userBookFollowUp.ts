/**
 * Patch `cover` and `hiveBookUri` onto a book record after the response.
 *
 * Neither is rendered by BookHive (covers come from `hive_book`), but the
 * cover costs three network hops plus a decode and the catalogue link can
 * mean a 20s scrape — the user waiting on a status click should pay for
 * neither. The patch is CAS'd on the cid the request wrote; on conflict it is
 * dropped, not forced, since the next write to a still-incomplete record
 * schedules it again. The request's wide event is gone by the time this
 * resolves, so the counter is the only signal.
 */
import type { SessionClient } from "../auth/client";
import type { BookUtilContext } from "../context";
import { LABEL, userBookFollowUpTotal } from "../metrics";
import type { BookRecordValue, UserBook } from "../types";
import { INVALID_SWAP, writeBookRecord } from "./bookRecordWrite";
import { ensureBookCataloged } from "./ensureBookCataloged";
import { Semaphore, withTimeout } from "./semaphore";
import { uploadImageBlob } from "./uploadImageBlob";
import { updateUserBook } from "./userBookStore";

export type FollowUpOutcome = "completed" | "nothing" | "conflict" | "failed";

const FOLLOW_UP_CONCURRENCY = 2;
/** Cover fetch (10s) + resize + upload, or enrich (10s) + catalog (10s), then one write. */
const FOLLOW_UP_DEADLINE_MS = 60_000;

const slots = new Semaphore(FOLLOW_UP_CONCURRENCY, { label: "user_book_follow_up" });
const inFlight = new Map<string, Promise<FollowUpOutcome>>();

export function followUpNeeds(
  record: BookRecordValue,
  { coverImage, canCatalog }: { coverImage: string | undefined; canCatalog: boolean },
): { cover: boolean; catalog: boolean } {
  return {
    cover: !record.cover && !!coverImage,
    catalog: !record.hiveBookUri && canCatalog,
  };
}

/** Never rejects: request handlers drop it, tests await it. */
export function completeUserBookRecord({
  ctx,
  agent,
  userBook,
  coverImage,
}: {
  ctx: BookUtilContext;
  agent: Pick<SessionClient, "did" | "post">;
  userBook: UserBook;
  coverImage: string | undefined;
}): Promise<FollowUpOutcome> {
  const record = userBook.record;
  if (!record) return Promise.resolve("nothing");
  const needs = followUpNeeds(record, { coverImage, canCatalog: !!ctx.serviceAccountAgent });
  if (!needs.cover && !needs.catalog) return Promise.resolve("nothing");

  const existing = inFlight.get(userBook.uri);
  if (existing) return existing;

  const run = async (): Promise<FollowUpOutcome> => {
    const patch: Partial<BookRecordValue> = {};
    if (needs.cover) {
      const blob = await uploadImageBlob(coverImage, agent, 800);
      if (blob) patch.cover = blob as BookRecordValue["cover"];
    }
    if (needs.catalog) {
      const hiveBookUri = await ensureBookCataloged(ctx, userBook.hiveId);
      if (hiveBookUri) patch.hiveBookUri = hiveBookUri;
    }
    if (Object.keys(patch).length === 0) return "nothing";

    const patched: BookRecordValue = { ...record, ...patch };
    const rkey = userBook.uri.split("/").at(-1)!;
    const written = await writeBookRecord({
      agent,
      rkey,
      record: patched,
      swapRecord: userBook.cid,
    });
    if (!written.ok) {
      if (written.error === INVALID_SWAP) return "conflict";
      throw new Error(`follow-up write failed: ${written.error} ${written.message ?? ""}`);
    }
    await updateUserBook({
      ctx,
      userBook: {
        ...userBook,
        cid: written.cid,
        indexedAt: new Date().toISOString(),
        record: patched,
      },
    });
    return "completed";
  };

  const task: Promise<FollowUpOutcome> = slots
    .run(() => withTimeout(run(), FOLLOW_UP_DEADLINE_MS, `follow-up ${userBook.uri}`))
    .catch((): FollowUpOutcome => "failed")
    .then((outcome) => {
      userBookFollowUpTotal.inc(LABEL.userBookFollowUp[outcome]);
      return outcome;
    })
    .finally(() => {
      inFlight.delete(userBook.uri);
    });
  inFlight.set(userBook.uri, task);
  return task;
}
