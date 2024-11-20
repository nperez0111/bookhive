import pino from "pino";
import Goodreads from "./goodreads.ts";

const logger = pino({ name: "scraper" });

export type { BookResult } from "./goodreads.ts";

export async function findBookDetails(
  query: string,
  fallbackCover = "NONE",
  locale = "en",
) {
  const searchService = new Goodreads(logger);

  try {
    const results = await searchService.search(query, fallbackCover, locale);

    if (results.length === 0) {
      return {
        success: false,
        message: "No books found",
        data: null,
      } as const;
    }

    return {
      success: true,
      message: "Books found",
      data: results,
    } as const;
  } catch (error) {
    logger.error("Error finding book details:", error);
    return {
      success: false,
      message: "Error searching for books",
      data: null,
    } as const;
  }
}