import axios from "axios";
import type { Logger } from "pino";
import { objectHash, sha256base64 } from "ohash";
// Type definitions
export interface MetaSourceInfo {
  id: string;
  description: string;
  link: string;
}

interface IsbnDbBook {
  title: string;
  title_long: string;
  isbn: string;
  isbn13: string;
  dewey_decimal: string;
  binding: string;
  publisher: string;
  language: string;
  date_published: string;
  edition: string;
  pages: number;
  dimensions: string;
  overview: string;
  image: string;
  msrp: number;
  excerpt: string;
  synopsis: string;
  authors: string[];
  subjects: string[];
}

interface IsbnDbSearchResponse {
  total: number;
  books: IsbnDbBook[];
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
  ratingsCount?: number;
  series?: string;
  series_index?: number;
  identifiers: {
    isbn: string;
    isbn13: string;
  };
  tags: string[];
}

export default class IsbnDb {
  public static readonly NAME = "ISBNdb";
  private static readonly ID = "isbndb";
  private static readonly DESCRIPTION = "ISBN Database";
  private static readonly META_URL = "https://isbndb.com/";
  private static readonly BOOK_URL = "https://isbndb.com/book/";
  private static readonly API_URL = "https://api2.isbndb.com";

  private readonly active: boolean;
  private readonly logger: Logger;
  private readonly apiKey: string;

  constructor(logger: Logger, apiKey: string, active: boolean = true) {
    this.active = active;
    this.logger = logger;
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    genericCover: string = "",
    locale: string = "en",
  ): Promise<BookResult[]> {
    if (!this.active) return [];

    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "500",
        column: "title",
        language: locale,
      });

      this.logger.trace({ params: params.toString() });

      const response = await axios.get<IsbnDbSearchResponse>(
        `${IsbnDb.API_URL}/books/${encodeURIComponent(query)}?${params.toString()}`,
        {
          headers: {
            Authorization: this.apiKey,
            "Content-Type": "application/json",
          },
        },
      );

      return response.data.books.map((result) =>
        this.parseSearchResult(result, genericCover),
      );
    } catch (error) {
      this.logger.warn({ message: "Error searching ISBNdb", error });
      return [];
    }
  }

  private parseSearchResult(
    book: IsbnDbBook,
    genericCover: string,
  ): BookResult {
    return {
      id: `bk_${sha256base64(
        objectHash({
          title: book.title.toLocaleLowerCase(),
          author: book.authors.slice(0).sort().join("*")?.toLocaleLowerCase(),
          isbn: [book.isbn13, book.isbn],
        }),
      ).slice(0, 20)}`,
      title: book.title,
      authors: book.authors,
      url: `${IsbnDb.BOOK_URL}${book.isbn13 || book.isbn}`,
      source: {
        id: IsbnDb.ID,
        description: IsbnDb.DESCRIPTION,
        link: IsbnDb.META_URL,
      },
      identifiers: {
        isbn: book.isbn,
        isbn13: book.isbn13,
      },
      cover: book.image || genericCover,
      thumbnail: book.image,
      description: book.overview || book.synopsis || "",
      publisher: book.publisher,
      publishedDate: book.date_published,
      series: undefined,
      series_index: undefined,
      tags: book.subjects,
    };
  }

  async lookupIsbn(
    isbn: string,
    genericCover: string = "",
  ): Promise<BookResult | null> {
    if (!this.active) return null;

    try {
      const response = await axios.get<IsbnDbBook>(
        `${IsbnDb.API_URL}/book/${isbn}`,
        {
          headers: {
            Authorization: this.apiKey,
            "Content-Type": "application/json",
          },
        },
      );

      return this.parseSearchResult(response.data, genericCover);
    } catch (error) {
      this.logger.warn({ message: "Error looking up ISBN", error });
      return null;
    }
  }
}
