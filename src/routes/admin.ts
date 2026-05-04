import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";

import type { AppEnv } from "../context";
import { env } from "../env";
import {
  cleanupExportPaths,
  createTgzReadStream,
  prepareSanitizedExportFiles,
  isAuthorizedExportRequest,
} from "../utils/dbExport";
import { backfillCatalogBooks, getBackfillProgress } from "../utils/catalogBookService";
import { createActorResolver } from "../bsky/id-resolver";
import { ids, Book as BookRecord, Buzz as BuzzRecord } from "../bsky/lexicon";
import { serializeUserBook } from "../utils/bookProgress";
import { searchBooks } from "./lib";
import type { HiveId, UserBook, Buzz } from "../types";

const admin = new Hono<AppEnv>()
  .post("/backfill-catalog", async (c) => {
    const ctx = c.get("ctx");
    const authorization = c.req.header("authorization");
    if (
      !env.EXPORT_SHARED_SECRET ||
      !isAuthorizedExportRequest({
        authorizationHeader: authorization,
        sharedSecret: env.EXPORT_SHARED_SECRET,
      })
    ) {
      return c.json({ message: "Not Found" }, 404);
    }

    if (!ctx.serviceAccountAgent) {
      return c.json({ message: "Service account not configured" }, 503);
    }

    const logger = c.get("appLogger");
    // Run in background — do not await
    backfillCatalogBooks({ ...ctx, logger }).catch((err) => {
      logger.error({ err }, "[backfill-catalog] Backfill failed");
    });

    ctx.addWideEventContext({ backfill_catalog: "started" });
    return c.json({ message: "Backfill started" }, 202);
  })
  .get("/backfill-catalog/progress", (c) => {
    const authorization = c.req.header("authorization");
    if (
      !env.EXPORT_SHARED_SECRET ||
      !isAuthorizedExportRequest({
        authorizationHeader: authorization,
        sharedSecret: env.EXPORT_SHARED_SECRET,
      })
    ) {
      return c.json({ message: "Not Found" }, 404);
    }

    return c.json(getBackfillProgress());
  })
  .get("/export", async (c) => {
    const ctx = c.get("ctx");
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    try {
      if (!env.EXPORT_SHARED_SECRET) {
        ctx.addWideEventContext({
          admin_export: "rejected",
          client_ip: clientIp,
          reason: "endpoint_not_configured",
        });
        return c.json({ message: "Not Found" }, 404);
      }

      const authorization = c.req.header("authorization");
      if (
        !isAuthorizedExportRequest({
          authorizationHeader: authorization,
          sharedSecret: env.EXPORT_SHARED_SECRET,
        })
      ) {
        ctx.addWideEventContext({
          admin_export: "rejected",
          client_ip: clientIp,
          reason: "invalid_authorization",
        });
        return c.json({ message: "Not Found" }, 404);
      }

      if (!env.DB_PATH || env.DB_PATH === ":memory:") {
        ctx.addWideEventContext({
          admin_export: "invalid",
          client_ip: clientIp,
          db_path: env.DB_PATH,
        });
        return c.json({ message: "DB exports require DB_PATH to be a file path" }, 400);
      }

      const exportDir =
        env.DB_EXPORT_DIR?.trim() || path.join(path.dirname(env.DB_PATH), "exports");

      ctx.addWideEventContext({
        admin_export: "started",
        client_ip: clientIp,
        export_dir: exportDir,
      });

      const startTimeExport = Date.now();
      let prepared: {
        tmpDir: string;
        filename: string;
        files: string[];
      };

      try {
        await fs.promises.mkdir(exportDir, { recursive: true });

        const includeKv =
          Boolean(env.KV_DB_PATH) && env.KV_DB_PATH !== ":memory:" && fs.existsSync(env.KV_DB_PATH);

        prepared = await prepareSanitizedExportFiles({
          dbPath: env.DB_PATH,
          kvPath: includeKv ? env.KV_DB_PATH : undefined,
          exportDir,
          includeKv,
        });
      } catch (err) {
        const duration = Date.now() - startTimeExport;
        c.set("requestError", err);
        ctx.addWideEventContext({
          admin_export: "failed",
          client_ip: clientIp,
          duration_ms: duration,
        });
        return c.json({ message: "Failed to create export archive" }, 500);
      }

      // Stream tar stdout directly to the response so bytes start flowing
      // immediately, avoiding proxy timeouts on large databases.
      const stream = createTgzReadStream(prepared.tmpDir, prepared.files, {
        onClose: () => {
          const duration = Date.now() - startTimeExport;
          ctx.addWideEventContext({
            admin_export: "completed",
            client_ip: clientIp,
            filename: prepared.filename,
            duration_ms: duration,
          });
          void cleanupExportPaths({ tmpDir: prepared.tmpDir });
        },
        onError: (err) => {
          ctx.addWideEventContext({
            admin_export_stream: "error",
            client_ip: clientIp,
            filename: prepared.filename,
            error: err.message,
          });
          void cleanupExportPaths({ tmpDir: prepared.tmpDir });
        },
      });

      return c.body(stream, 200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${prepared.filename}"`,
        "Cache-Control": "no-store",
      });
    } catch (err) {
      c.set("requestError", err);
      ctx.addWideEventContext({
        admin_export: "error",
        client_ip: clientIp,
      });
      return c.json({ message: "Internal server error" }, 500);
    }
  })
  .post("/refresh-user-books", async (c) => {
    const ctx = c.get("ctx");
    const authorization = c.req.header("authorization");
    if (
      !env.EXPORT_SHARED_SECRET ||
      !isAuthorizedExportRequest({
        authorizationHeader: authorization,
        sharedSecret: env.EXPORT_SHARED_SECRET,
      })
    ) {
      return c.json({ message: "Not Found" }, 404);
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      handle?: string;
      did?: string;
    };
    const identifier = body.did || body.handle;
    if (!identifier) {
      return c.json({ message: "Must provide 'handle' or 'did' in request body" }, 400);
    }

    const logger = c.get("appLogger");
    try {
      // Resolve to DID + PDS
      const actorResolver = createActorResolver();
      const actor = await actorResolver.resolve(
        identifier as Parameters<typeof actorResolver.resolve>[0],
      );
      const did = actor.did;
      const pds = actor.pds;

      if (!pds) {
        return c.json({ message: "Could not resolve PDS for user" }, 404);
      }

      ctx.addWideEventContext({ admin_refresh_user: did, pds });

      // Read-only refresh: fetch books from user's PDS (unauthenticated) and upsert locally
      const uris: string[] = [];
      let cursor: string | undefined;
      let totalBooks = 0;

      do {
        const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set("repo", did);
        url.searchParams.set("collection", ids.BuzzBookhiveBook);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);

        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          return c.json({ message: `PDS returned ${res.status} fetching book records` }, 502);
        }

        const data = (await res.json()) as {
          records: Array<{ uri: string; cid: string; value: unknown }>;
          cursor?: string;
        };

        const indexedAt = new Date().toISOString();
        const validBooks = data.records.flatMap((record) => {
          const parsed = BookRecord.validateRecord(record.value);
          return parsed.success ? [{ record, book: parsed.value }] : [];
        });

        const rowsToUpsert = validBooks.map(({ record, book }) => {
          uris.push(record.uri);

          // Fire-and-forget search to ensure hive_book entries exist
          void searchBooks({ query: book.title, ctx });

          return serializeUserBook({
            uri: record.uri,
            cid: record.cid,
            userDid: did,
            createdAt: book.createdAt,
            title: book.title,
            authors: book.authors,
            indexedAt,
            hiveId: book.hiveId as HiveId,
            status: book.status ?? null,
            owned: book.owned ? 1 : 0,
            startedAt: book.startedAt ?? null,
            finishedAt: book.finishedAt ?? null,
            review: book.review ?? null,
            stars: book.stars ?? null,
            bookProgress: book.bookProgress ?? null,
          } satisfies UserBook);
        });

        for (let i = 0; i < rowsToUpsert.length; i += 100) {
          await ctx.db
            .insertInto("user_book")
            .values(rowsToUpsert.slice(i, i + 100))
            .onConflict((oc) =>
              oc.column("uri").doUpdateSet((c) => ({
                cid: c.ref("excluded.cid"),
                userDid: c.ref("excluded.userDid"),
                createdAt: c.ref("excluded.createdAt"),
                indexedAt: c.ref("excluded.indexedAt"),
                title: c.ref("excluded.title"),
                authors: c.ref("excluded.authors"),
                status: c.ref("excluded.status"),
                owned: c.ref("excluded.owned"),
                startedAt: c.ref("excluded.startedAt"),
                finishedAt: c.ref("excluded.finishedAt"),
                hiveId: c.ref("excluded.hiveId"),
                review: c.ref("excluded.review"),
                stars: c.ref("excluded.stars"),
                bookProgress: c.ref("excluded.bookProgress"),
              })),
            )
            .execute();
        }

        totalBooks += validBooks.length;
        cursor = data.cursor;
        if (cursor) await new Promise((r) => setTimeout(r, 100));
      } while (cursor);

      // Clean up stale local records not found on the PDS
      if (uris.length === 0) {
        await ctx.db.deleteFrom("user_book").where("userDid", "=", did).execute();
      } else {
        await ctx.db
          .deleteFrom("user_book")
          .where("userDid", "=", did)
          .where("uri", "not in", uris)
          .execute();
      }

      // Also refresh buzzes
      const buzzUris: string[] = [];
      let buzzCursor: string | undefined;
      do {
        const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set("repo", did);
        url.searchParams.set("collection", ids.BuzzBookhiveBuzz);
        url.searchParams.set("limit", "100");
        if (buzzCursor) url.searchParams.set("cursor", buzzCursor);

        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) break;

        const data = (await res.json()) as {
          records: Array<{ uri: string; cid: string; value: unknown }>;
          cursor?: string;
        };

        const validBuzzes = data.records.flatMap((record) => {
          const parsed = BuzzRecord.validateRecord(record.value);
          return parsed.success ? [{ record, buzz: parsed.value }] : [];
        });

        if (validBuzzes.length > 0) {
          const bookUris = validBuzzes.map((r) => r.buzz.book.uri);
          const bookRows = await ctx.db
            .selectFrom("user_book")
            .select(["uri", "hiveId"])
            .where("uri", "in", bookUris)
            .execute();
          const uriToHiveId = new Map(bookRows.map((r) => [r.uri, r.hiveId]));

          const buzzRows = validBuzzes
            .filter(({ buzz }) => uriToHiveId.has(buzz.book.uri))
            .map(
              ({ record, buzz }) =>
                ({
                  uri: record.uri,
                  cid: record.cid,
                  userDid: did,
                  hiveId: uriToHiveId.get(buzz.book.uri)!,
                  createdAt: buzz.createdAt,
                  indexedAt: new Date().toISOString(),
                  bookCid: buzz.book.cid,
                  bookUri: buzz.book.uri,
                  comment: buzz.comment,
                  parentCid: buzz.parent.cid,
                  parentUri: buzz.parent.uri,
                }) satisfies Buzz,
            );

          for (let i = 0; i < buzzRows.length; i += 100) {
            await ctx.db
              .insertInto("buzz")
              .values(buzzRows.slice(i, i + 100))
              .onConflict((oc) =>
                oc.column("uri").doUpdateSet((c) => ({
                  cid: c.ref("excluded.cid"),
                  hiveId: c.ref("excluded.hiveId"),
                  comment: c.ref("excluded.comment"),
                  indexedAt: c.ref("excluded.indexedAt"),
                })),
              )
              .execute();
          }

          for (const r of validBuzzes) {
            buzzUris.push(r.record.uri);
          }
        }

        buzzCursor = data.cursor;
        if (buzzCursor) await new Promise((r) => setTimeout(r, 100));
      } while (buzzCursor);

      // Clean up stale buzz records
      if (buzzUris.length > 0) {
        await ctx.db
          .deleteFrom("buzz")
          .where("userDid", "=", did)
          .where("uri", "not in", buzzUris)
          .execute();
      }

      ctx.addWideEventContext({
        admin_refresh_user_books: "completed",
        total_books: totalBooks,
        total_buzzes: buzzUris.length,
      });

      return c.json({
        message: "Refresh completed",
        did,
        booksRefreshed: totalBooks,
        buzzesRefreshed: buzzUris.length,
      });
    } catch (err) {
      logger.error({ err }, "[admin/refresh-user-books] Failed");
      ctx.addWideEventContext({
        admin_refresh_user_books: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ message: err instanceof Error ? err.message : "Internal error" }, 500);
    }
  });

export default admin;
