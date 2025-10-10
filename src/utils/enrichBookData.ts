import type { HiveBook } from "../types";
import { getBookDetailedInfo } from "../scrapers/moreInfo";
import type { AppContext } from "..";

interface BookMeta {
  publisher: string;
  publicationYear: number;
  language: string;
  isbn?: string;
  isbn13?: string;
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
        ctx.logger.debug("Book already enriched recently", { bookId: book.id });
        return;
      }
    }

    // Only enrich Goodreads books with sourceUrl
    if (book.source !== "Goodreads" || !book.sourceUrl) {
      ctx.logger.debug(
        "Skipping enrichment - not a Goodreads book or no sourceUrl",
        {
          bookId: book.id,
          source: book.source,
          hasSourceUrl: !!book.sourceUrl,
        },
      );
      return;
    }

    ctx.logger.info("Starting book enrichment", {
      bookId: book.id,
      sourceUrl: book.sourceUrl,
    });

    const detailedData = await getBookDetailedInfo(book.sourceUrl);

    if (!detailedData) {
      ctx.logger.warn("Failed to fetch detailed data", {
        bookId: book.id,
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
    };

    // Update the book record with enriched data
    await ctx.db
      .updateTable("hive_book")
      .set({
        genres,
        series,
        meta: JSON.stringify(meta),
        description: detailedData.book.description || book.description, // Use better description if available
        rating: Math.round(detailedData.work.averageRating * 1000), // Convert to our rating format
        ratingsCount: detailedData.work.ratingsCount,
        enrichedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", book.id)
      .execute();

    ctx.logger.info("Successfully enriched book", {
      bookId: book.id,
      genres: detailedData.book.genres.length,
      hasSeries: !!detailedData.book.series,
      hasAuthorBio: !!detailedData.book.primaryAuthor.description,
    });
  } catch (error) {
    ctx.logger.error("Error enriching book data", {
      bookId: book.id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - enrichment failures shouldn't break the app
  }
}
