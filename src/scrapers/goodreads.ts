import axios from "axios";
import type { Logger } from "pino";

// Type definitions
export interface MetaSourceInfo {
  id: string;
  description: string;
  link: string;
}

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

export interface BookResult {
  id: string;
  title: string;
  authors: string[];
  url: string;
  source: MetaSourceInfo;
  cover?: string;
  thumbnail?: string;
  description?: string;
  publisher?: string;
  publishedDate?: string;
  rating?: number;
  series?: string;
  series_index?: number;
  tags?: string[];
  identifiers: {
    goodreads: string;
  };
}

class Goodreads {
  public static readonly NAME = "Goodreads";
  private static readonly ID = "goodreads";
  private static readonly DESCRIPTION = "Goodreads Books";
  private static readonly META_URL = "https://www.goodreads.com/";
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
  ): Promise<BookResult[]> {
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
      this.logger.warn({ message: "Error searching Goodreads", error });
      return [];
    }
  }

  private parseSearchResult(
    result: GoodreadsBook,
    genericCover: string,
  ): BookResult {
    // Extract series info from title if present
    const seriesMatch = result.title.match(/\((.*?),\s*#(\d+)\)/);

    const match: BookResult = {
      id: result.bookId,
      title: result.bookTitleBare,
      authors: [result.author.name],
      url: `${Goodreads.BOOK_URL}${result.bookId}`,
      source: {
        id: Goodreads.ID,
        description: Goodreads.DESCRIPTION,
        link: Goodreads.META_URL,
      },
      identifiers: {
        goodreads: result.bookId,
      },
      cover: this.parseCover(result, genericCover),
      thumbnail: result.imageUrl,
      description: this.parseDescription(result.description),
      rating: parseFloat(result.avgRating) || 0,
      series: seriesMatch ? seriesMatch[1] : undefined,
      series_index: seriesMatch ? parseInt(seriesMatch[2]) : undefined,
    };

    return match;
  }

  private parseCover(result: GoodreadsBook, genericCover: string): string {
    if (result.imageUrl) {
      // Convert thumbnail URL to full-size image URL
      return result.imageUrl.replace("._SX50_", "");
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
