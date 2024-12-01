import pino from "pino";
import Goodreads from "./goodreads.ts";
// import IsbnDb from "./isbndb.ts";
import Google from "./google.ts";
// import { env } from "../env.ts";

const logger = pino({ name: "scraper" });

export type { BookResult } from "./goodreads.ts";

export async function findBookDetails(
  query: string,
  {
    fallbackCover = "NONE",
    locale = "en",
    provider = "goodreads",
  }: {
    fallbackCover?: string;
    locale?: string;
    provider?: "goodreads" | "isbndb" | "google";
  } = {},
) {
  let searchService: Goodreads | Google;

  if (provider === "goodreads") {
    searchService = new Goodreads(logger);
  }
  // else if (provider === "isbndb") {
  //   searchService = new IsbnDb(logger, env.ISBN_DB_API_KEY);
  // }
  else if (provider === "google") {
    searchService = new Google(logger);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

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
