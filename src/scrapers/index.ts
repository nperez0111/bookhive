import Goodreads from "./goodreads.ts";
import { getLogger } from "../logger/index.ts";
// import IsbnDb from "./isbndb.ts";
// import Google from "./google.ts";
// import { env } from "../env.ts";

const logger = getLogger({ name: "scraper" });

export async function findBookDetails(
  query: string,
  {
    fallbackCover = "NONE",
    locale = "en",
  }: {
    fallbackCover?: string;
    locale?: string;
  } = {},
) {
  const searchService = new Goodreads(logger);

  try {
    logger.trace("searching for results", { query });
    const results = await searchService.search(query, fallbackCover, locale);
    logger.trace("found results", { query, numResults: results.length });

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
