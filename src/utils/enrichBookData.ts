import { syncHiveBookGenres } from "../db";
import type { BookIdentifiers, HiveBook } from "../types";
import { getBookDetailedInfo } from "../scrapers/moreInfo";
import type { AppContext } from "../context";
import { upsertBookIdentifiers } from "./bookIdentifiers";

interface BookMeta {
  publisher: string;
  publicationYear: number;
  language: string;
  isbn?: string;
  isbn13?: string;
  numPages?: number;
  authorBio: string;
  secondaryAuthors: Array<{
    name: string;
    role: string;
  }>;
  ratingsDistribution: number[];
}

export async function enrichBookWithDetailedData(
  book: HiveBook,
  ctx: AppContext,
): Promise<void> {
  try {
    // Skip if already enriched recently (within 30 days)
    if (book.enrichedAt) {
      const enrichedDate = new Date(book.enrichedAt);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (enrichedDate > thirtyDaysAgo) {
        ctx.addWideEventContext({
          enrichment: "skipped",
          bookId: book.id,
          reason: "already_enriched_recently",
        });
        return;
      }
    }

    // Only enrich Goodreads books with sourceUrl
    if (book.source !== "Goodreads" || !book.sourceUrl) {
      ctx.addWideEventContext({
        enrichment: "skipped",
        bookId: book.id,
        reason: "not_goodreads_or_no_source_url",
        source: book.source,
      });
      return;
    }

    ctx.addWideEventContext({
      enrichment: "started",
      bookId: book.id,
      sourceUrl: book.sourceUrl,
    });

    const detailedData = await getBookDetailedInfo(book.sourceUrl);

    if (!detailedData) {
      ctx.addWideEventContext({
        enrichment: "failed",
        bookId: book.id,
        reason: "fetch_detailed_data_failed",
        sourceUrl: book.sourceUrl,
      });
      return;
    }

    // Map ParsedGoodreadsData to database fields
    const genres =
      detailedData.book.genres.length > 0
        ? JSON.stringify(detailedData.book.genres)
        : null;

    const series = detailedData.book.series
      ? JSON.stringify({
          title: detailedData.book.series.title,
          position: detailedData.book.series.position,
          webUrl: detailedData.book.series.webUrl,
        })
      : null;

    const meta: BookMeta = {
      publisher: detailedData.book.details.publisher || "",
      publicationYear: detailedData.book.details.publicationYear || 0,
      language: detailedData.book.details.language || "",
      isbn: detailedData.book.details.isbn,
      isbn13: detailedData.book.details.isbn13,
      authorBio: detailedData.book.primaryAuthor.description || "",
      secondaryAuthors: detailedData.book.secondaryContributors || [],
      ratingsDistribution: detailedData.work.ratingsDistribution || [],
      numPages: detailedData.book.details.numPages,
    };

    // Merge identifiers with existing ones
    const existingIdentifiers: BookIdentifiers = book.identifiers
      ? JSON.parse(book.identifiers)
      : {};
    const updatedIdentifiers: BookIdentifiers = {
      ...existingIdentifiers,
      hiveId: book.id,
      goodreadsId: book.sourceId || existingIdentifiers.goodreadsId,
      isbn10: detailedData.book.details.isbn || existingIdentifiers.isbn10,
      isbn13: detailedData.book.details.isbn13 || existingIdentifiers.isbn13,
    };

    const serializedMeta = JSON.stringify(meta);
    // Update the book record with enriched data
    await ctx.db
      .updateTable("hive_book")
      .set({
        genres,
        series,
        meta: serializedMeta,
        identifiers: JSON.stringify(updatedIdentifiers),
        description: detailedData.book.description || book.description, // Use better description if available
        rating: Math.round(detailedData.work.averageRating * 1000), // Convert to our rating format
        ratingsCount: detailedData.work.ratingsCount,
        enrichedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", book.id)
      .execute();

    await syncHiveBookGenres(ctx.db, book.id, genres);

    await upsertBookIdentifiers(ctx.db, {
      ...book,
      sourceId: detailedData.book.id || book.sourceId,
      meta: serializedMeta,
    });

    ctx.addWideEventContext({
      enrichment: "completed",
      bookId: book.id,
      genres_count: detailedData.book.genres.length,
      has_series: !!detailedData.book.series,
      has_author_bio: !!detailedData.book.primaryAuthor.description,
    });
  } catch (error) {
    ctx.addWideEventContext({
      enrichment: "error",
      bookId: book.id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - enrichment failures shouldn't break the app
  }
}
