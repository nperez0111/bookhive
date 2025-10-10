import axios from "axios";
import type { Logger } from "pino";
import type { HiveBook } from "../types";
import { getHiveId } from "./getHiveId";

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
  private static readonly SEARCH_URL =
    "https://www.goodreads.com/book/auto_complete";

  private readonly active: boolean;
  private readonly logger: Logger;

  constructor(logger: Logger, active: boolean = true) {
    this.active = active;
    this.logger = logger;
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
      });

      this.logger.trace({ params: params.toString() });

      const response = await axios.get<GoodreadsBook[]>(
        `${Goodreads.SEARCH_URL}?${params.toString()}`,
        {
          headers: {
            accept: "*/*",
            "cache-control": "no-cache",
            "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
            "x-requested-with": "XMLHttpRequest",
          },
        },
      );

      return response.data.map((result) =>
        this.parseSearchResult(result, genericCover),
      );
    } catch (error) {
      this.logger.warn(
        {
          error,
        },
        "Error searching Goodreads",
      );
      return [];
    }
  }

  private parseSearchResult(
    result: GoodreadsBook,
    genericCover: string,
  ): HiveBook {
    const now = new Date().toISOString();
    // Unfortunately, the Goodreads API does not provide a list of authors
    const authors = result.author.name;

    return {
      id: getHiveId({
        title: result.bookTitleBare,
        authors,
      }),
      title: result.bookTitleBare,
      rawTitle: result.title,
      authors,
      source: Goodreads.NAME,
      sourceUrl: `${Goodreads.BOOK_URL}${result.bookId}`,
      sourceId: result.bookId,
      cover: this.parseCover(result, genericCover),
      thumbnail: result.imageUrl,
      description: this.parseDescription(result.description),
      rating: parseInt((parseFloat(result.avgRating) * 1000).toString()),
      ratingsCount: parseInt(result.ratingsCount.toString()),
      createdAt: now,
      updatedAt: now,
      genres: null,
      series: null,
      meta: null,
      enrichedAt: null,
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

  private parseDescription(
    description: GoodreadsDescription | undefined,
  ): string {
    // Remove HTML tags from description
    return description?.html.replace(/<[^>]*>/g, "") || "";
  }
}

export default Goodreads;
