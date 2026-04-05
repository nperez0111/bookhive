import { scraperDuration, scraperRequestsTotal, activeOperations, LABEL } from "../metrics";
import Goodreads from "./goodreads.ts";
// import IsbnDb from "./isbndb.ts";
// import Google from "./google.ts";
// import { env } from "../env.ts";

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
  const searchService = new Goodreads();
  const end = scraperDuration.startTimer(LABEL.scraper.search);
  activeOperations.inc(LABEL.op.scrape);

  try {
    const results = await searchService.search(query, fallbackCover, locale);

    if (results.length === 0) {
      scraperRequestsTotal.inc(LABEL.scraperOutcome.empty);
      return {
        success: false,
        message: "No books found",
        data: null,
      } as const;
    }

    scraperRequestsTotal.inc(LABEL.scraperOutcome.success);
    return {
      success: true,
      message: "Books found",
      data: results,
    } as const;
  } catch {
    scraperRequestsTotal.inc(LABEL.scraperOutcome.error);
    return {
      success: false,
      message: "Error searching for books",
      data: null,
    } as const;
  } finally {
    end();
    activeOperations.dec(LABEL.op.scrape);
  }
}
