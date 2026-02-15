// Warning: This is AI slop, translated from https://github.com/janeczku/calibre-web/blob/master/cps/metadata_provider/google.py
import { LANGUAGE_NAMES, languageMap } from "./languageNames";

// Type definitions
export interface MetaSourceInfo {
  id: string;
  description: string;
  link: string;
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
  languages?: string[];
  publisher?: string;
  publishedDate?: string;
  rating?: number;
  series?: string;
  series_index?: number;
  tags?: string[];
  identifiers: {
    google: string;
    isbn?: string;
  };
}

interface GoogleVolumeInfo {
  title: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedDate?: string;
  averageRating?: number;
  language?: string;
  categories?: string[];
  imageLinks?: {
    thumbnail: string;
  };
  industryIdentifiers?: Array<{
    type: string;
    identifier: string;
  }>;
}

interface GoogleSearchResult {
  id: string;
  volumeInfo: GoogleVolumeInfo;
}

interface GoogleSearchResponse {
  items?: GoogleSearchResult[];
}

class Google {
  public static readonly NAME = "Google";
  private static readonly ID = "google";
  private static readonly DESCRIPTION = "Google Books";
  private static readonly META_URL = "https://books.google.com/";
  private static readonly BOOK_URL = "https://books.google.com/books?id=";
  private static readonly SEARCH_URL =
    "https://www.googleapis.com/books/v1/volumes?q=";

  private readonly active: boolean;

  constructor(active: boolean = true) {
    this.active = active;
  }

  private getTitleTokens(
    title: string,
    stripJoiners: boolean = true,
  ): string[] {
    // Title patterns to clean up the search string
    const titlePatterns: [RegExp, string][] = [
      // Remove things like: (2010) (Omnibus) etc.
      [
        /[({\[](\d{4}|omnibus|anthology|hardcover|audiobook|audio\scd|paperback|turtleback|mass\s*market|edition|ed\.)[\])}]/gi,
        "",
      ],

      // Remove any strings that contain the substring edition inside parentheses
      [/[({\[].*?(edition|ed\.).*?[\]})]]/gi, ""],

      // Remove commas used as separators in numbers
      [/(\d+),(\d+)/g, "$1$2"],

      // Remove hyphens only if they have whitespace before them
      [/(\s-)/g, " "],

      // Replace other special chars with a space
      [/[:,;!@$%^&*(){}.`~"\s\[\]/]《》「」""""/g, " "],
    ];

    // Apply all patterns sequentially
    let cleanTitle = title;
    for (const [pattern, replacement] of titlePatterns) {
      cleanTitle = cleanTitle.replace(pattern, replacement);
    }

    // Split into tokens and filter
    const tokens = cleanTitle
      .split(/\s+/)
      .map((token) => token.trim().replace(/['"]/g, ""))
      .filter((token) => token.length > 0)
      .filter(
        (token) =>
          !stripJoiners ||
          !["a", "and", "the", "&"].includes(token.toLowerCase()),
      );

    return tokens;
  }

  async search(
    query: string,
    genericCover: string = "",
    locale: string = "en",
  ): Promise<BookResult[]> {
    if (!this.active) {
      return [];
    }

    try {
      const titleTokens = this.getTitleTokens(query, false);
      let searchQuery = query;

      if (titleTokens.length > 0) {
        searchQuery = titleTokens.map((t) => encodeURIComponent(t)).join("+");
      }
      // For now, we are only searching in one language
      searchQuery += "&langRestrict=" + locale;

      const response = await fetch(`${Google.SEARCH_URL}${searchQuery}`);

      if (!response.ok) throw new Error(response.statusText);
      const data = (await response.json()) as GoogleSearchResponse;

      return (data.items || []).map((result) =>
        this.parseSearchResult(result, genericCover, locale),
      );
    } catch {
      return [];
    }
  }

  private parseSearchResult(
    result: GoogleSearchResult,
    genericCover: string,
    locale: string,
  ): BookResult {
    const match: BookResult = {
      id: result.id,
      title: result.volumeInfo.title,
      authors: result.volumeInfo.authors || [],
      url: `${Google.BOOK_URL}${result.id}`,
      source: {
        id: Google.ID,
        description: Google.DESCRIPTION,
        link: Google.META_URL,
      },
      identifiers: {
        google: result.id,
      },
    };

    // Parse cover
    match.cover = this.parseCover(result.volumeInfo, genericCover);
    match.thumbnail = result.volumeInfo.imageLinks?.thumbnail || genericCover;

    // Parse other fields
    match.description = result.volumeInfo.description || "";
    match.languages = this.parseLanguages(result.volumeInfo, locale);
    match.publisher = result.volumeInfo.publisher || "";
    match.publishedDate = this.parsePublishedDate(
      result.volumeInfo.publishedDate,
    );
    match.rating = result.volumeInfo.averageRating || 0;
    match.series = "";
    match.series_index = 1;
    match.tags = result.volumeInfo.categories || [];

    // Parse ISBN
    this.parseIsbn(result.volumeInfo, match);

    return match;
  }

  private parseIsbn(volumeInfo: GoogleVolumeInfo, match: BookResult): void {
    const identifiers = volumeInfo.industryIdentifiers || [];
    const isbn13 = identifiers.find((id) => id.type === "ISBN_13");
    const isbn10 = identifiers.find((id) => id.type === "ISBN_10");
    if (isbn13) {
      match.identifiers.isbn = isbn13.identifier;
    }
    if (!match.identifiers.isbn && isbn10) {
      match.identifiers.isbn = isbn10.identifier;
    }
  }

  private parseCover(
    volumeInfo: GoogleVolumeInfo,
    genericCover: string,
  ): string {
    if (volumeInfo.imageLinks?.thumbnail) {
      let coverUrl = volumeInfo.imageLinks.thumbnail;

      // Strip curl in cover
      coverUrl = coverUrl.replace("&edge=curl", "");

      // Request 800x900 cover image (higher resolution)
      coverUrl += "&fife=w800-h900";

      return coverUrl.replace("http://", "https://");
    }
    return genericCover;
  }

  private parseLanguages(
    volumeInfo: GoogleVolumeInfo,
    locale: string,
  ): string[] {
    const languageIso2 = volumeInfo.language || "";

    return languageIso2
      ? [
          this.getLanguageName(
            locale as keyof typeof LANGUAGE_NAMES,
            this.getLang3(languageIso2),
          ),
        ]
      : [];
  }

  private parsePublishedDate(date?: string): string {
    if (!date) return "";

    try {
      // Verify the date is in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const parsedDate = new Date(date);
        if (!isNaN(parsedDate.getTime())) {
          return date;
        }
      }
      return "";
    } catch {
      return "";
    }
  }

  // Placeholder methods for language conversion
  // These would need to be implemented based on your language mapping requirements
  private getLang3(lang: string): string {
    try {
      // Return 3-letter code if input is already 3 letters
      if (lang.length === 3) {
        return lang;
      }
      // Convert 2-letter code to 3-letter code
      if (lang.length === 2) {
        return (
          languageMap[lang.toLowerCase() as keyof typeof languageMap] || lang
        );
      }
      return "";
    } catch {
      return lang;
    }
  }

  private getLanguageName(
    locale: keyof typeof LANGUAGE_NAMES,
    langCode: string,
  ): string {
    const UNKNOWN_TRANSLATION = "Unknown";

    try {
      const names = LANGUAGE_NAMES[locale] || LANGUAGE_NAMES["en"];
      if (!names) return UNKNOWN_TRANSLATION;
      return names[langCode as keyof typeof names] || UNKNOWN_TRANSLATION;
    } catch {
      return UNKNOWN_TRANSLATION;
    }
  }
}

export default Google;
