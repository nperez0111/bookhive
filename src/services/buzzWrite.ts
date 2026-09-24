/**
 * The one "post or edit a buzz". `POST /comments` and `POST /api/update-comment`
 * are thin adapters over it — the core owns the rules and returns a
 * discriminated result, never throws, so each adapter owns its own status code.
 */
import * as TID from "@atcute/tid";

import type { SessionClient } from "../auth/client";
import type { BookUtilContext } from "../context";
import { ids, validateMain } from "../bsky/lexicon/index";
import type { Buzz, HiveId } from "../types";
import { buzzUpsertSet } from "../db";

export type BuzzWriteInput = {
  hiveId: HiveId;
  comment: string;
  parentUri: string;
  parentCid: string;
  /** Present when editing; absent creates a new record. */
  uri?: string | undefined;
};

export type BuzzWriteResult =
  | { ok: true; buzz: Pick<Buzz, "uri" | "cid" | "createdAt"> }
  | { ok: false; reason: "book_not_found" | "write_failed"; message: string };

type ApplyWritesOut = {
  results?: Array<{ $type: string; uri?: string; cid?: string }>;
};

export async function upsertBuzz({
  ctx,
  agent,
  input,
}: {
  ctx: BookUtilContext;
  agent: SessionClient;
  input: BuzzWriteInput;
}): Promise<BuzzWriteResult> {
  const { hiveId, comment, parentUri, parentCid, uri } = input;

  const [originalBuzz, book] = await Promise.all([
    uri
      ? ctx.db.selectFrom("buzz").selectAll().where("uri", "=", uri).limit(1).executeTakeFirst()
      : Promise.resolve(undefined),
    // Scoped to this user — filtering on hiveId alone can point the strongRef
    // at a stranger's user_book row.
    ctx.db
      .selectFrom("user_book")
      .select(["cid", "uri"])
      .where("hiveId", "=", hiveId)
      .where("userDid", "=", agent.did)
      .limit(1)
      .executeTakeFirst(),
  ]);

  const bookRef = validateMain({ uri: book?.uri, cid: book?.cid });
  const parentRef = validateMain({ uri: parentUri, cid: parentCid });
  if (!book || !bookRef.success || !bookRef.value || !parentRef.success) {
    return {
      ok: false,
      reason: "book_not_found",
      message: "The book you are looking for does not exist",
    };
  }

  const createdAt = originalBuzz?.createdAt || new Date().toISOString();

  const response = await agent.post("com.atproto.repo.applyWrites", {
    input: {
      repo: agent.did,
      writes: [
        {
          $type: originalBuzz
            ? "com.atproto.repo.applyWrites#update"
            : "com.atproto.repo.applyWrites#create",
          collection: ids.BuzzBookhiveBuzz,
          rkey: originalBuzz ? originalBuzz.uri.split("/").at(-1)! : TID.now(),
          value: { book: bookRef.value, comment, parent: parentRef.value, createdAt },
        },
      ],
    },
  });

  const out = response.data as ApplyWritesOut | null;
  const firstResult = response.ok && out?.results?.[0] ? out.results[0] : undefined;
  if (
    !response.ok ||
    !firstResult?.uri ||
    !firstResult.cid ||
    !(
      firstResult.$type === "com.atproto.repo.applyWrites#createResult" ||
      firstResult.$type === "com.atproto.repo.applyWrites#updateResult"
    )
  ) {
    ctx.addWideEventContext({
      buzz_write: "failed",
      hiveId,
      userDid: agent.did,
      error: "applyWrites result invalid",
    });
    return {
      ok: false,
      reason: "write_failed",
      message: "Failed to write comment to the database",
    };
  }

  await ctx.db
    .insertInto("buzz")
    .values({
      uri: firstResult.uri,
      cid: firstResult.cid,
      userDid: agent.did,
      createdAt,
      indexedAt: new Date().toISOString(),
      hiveId,
      comment,
      parentUri,
      parentCid,
      bookCid: book.cid,
      bookUri: book.uri,
    })
    .onConflict((oc) => oc.column("uri").doUpdateSet(buzzUpsertSet))
    .execute();

  ctx.addWideEventContext({
    buzz_write: originalBuzz ? "updated" : "created",
    hiveId,
    userDid: agent.did,
    buzz_uri: firstResult.uri,
  });

  return { ok: true, buzz: { uri: firstResult.uri, cid: firstResult.cid, createdAt } };
}
