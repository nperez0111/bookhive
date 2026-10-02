import type { HiveBook } from "../types";
import { getHiveId } from "./getHiveId";
import { normalizeGoodreadsId } from "../data/bookIdentifiers";
import { apiHeaders, UA } from "./waf/http";
import { displayRatingToHiveRating } from "../core/rating";

interface GoodreadsAuthor {
  id: number;
  name: string;
  isGoodreadsAuthor: boolean;
  profileUrl: string;
  worksListUrl: string;
}

interface GoodreadsDescription {
  html: string;
  truncated: boolean;
  fullContentUrl: string;
}

interface GoodreadsBook {
  imageUrl: string;
  bookId: string;
  workId: string;
  bookUrl: string;
  title: string;
  bookTitleBare: string;
  numPages: number | null;
  avgRating: string;
  ratingsCount: number;
  author: GoodreadsAuthor;
  description: GoodreadsDescription;
}

class Goodreads {
  public static readonly NAME = "Goodreads";
  private static readonly BOOK_URL = "https://www.goodreads.com/book/show/";
  private static readonly ORIGIN = "https://www.goodreads.com";
  private static readonly SEARCH_URL = `${Goodreads.ORIGIN}/book/auto_complete`;

  private readonly active: boolean;

  constructor(active: boolean = true) {
    this.active = active;
  }

  async search(
    query: string,
    genericCover: string = "",
    _locale: string = "en",
  ): Promise<HiveBook[]> {
    if (!this.active) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        format: "json",
        q: query,
        limit: "20",
      });

      // Must claim the same browser as the page fetch — a mismatched sec-ch-ua/
      // User-Agent pair is a one-line bot signature (see src/scrapers/waf/README.md).
      const response = await fetch(`${Goodreads.SEARCH_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          ...apiHeaders(Goodreads.ORIGIN, UA, true),
          "x-requested-with": "XMLHttpRequest",
        },
      });

      if (!response.ok) throw new Error(response.statusText);
      const data = (await response.json()) as GoodreadsBook[];

      return data.map((result) => this.parseSearchResult(result, genericCover));
    } catch {
      return [];
    }
  }

  private parseSearchResult(result: GoodreadsBook, genericCover: string): HiveBook {
    const now = new Date().toISOString();
    // Unfortunately, the Goodreads API does not provide a list of authors
    const authors = result.author.name;

    const hiveId = getHiveId({
      title: result.bookTitleBare,
      authors,
    });

    const goodreadsId = normalizeGoodreadsId(result.bookId);

    return {
      id: hiveId,
      enrichAttempts: 0,
      enrichFailedAt: null,
      title: result.bookTitleBare,
      rawTitle: result.title,
      authors,
      source: Goodreads.NAME,
      sourceUrl: `${Goodreads.BOOK_URL}${result.bookId}`,
      sourceId: result.bookId,
      cover: this.parseCover(result, genericCover),
      thumbnail: result.imageUrl,
      description: this.parseDescription(result.description),
      rating: displayRatingToHiveRating(parseFloat(result.avgRating)),
      ratingsCount: parseInt(result.ratingsCount.toString()),
      createdAt: now,
      updatedAt: now,
      series: null,
      meta: null,
      enrichedAt: null,
      identifiers: JSON.stringify({
        hiveId,
        ...(goodreadsId && { goodreadsId }),
      }),
      language: null,
      hiveBookAtUri: null,
      hiveBookCatalogUpdatedAt: null,
    };
  }

  // TODO look into this book: https://bookhive.buzz/books/bk_RqXDuG9xDvdiMDVd3osP
  private parseCover(result: GoodreadsBook, genericCover: string): string {
    if (result.imageUrl) {
      // Convert thumbnail URL to full-size image URL
      return result.imageUrl.replace(/\._[A-Z][A-Z]\d+_/, "");
    }
    return genericCover;
  }

  private parseDescription(description: GoodreadsDescription | undefined): string {
    return description?.html.replace(/<[^>]*>/g, "") || "";
  }
}

export default Goodreads;
