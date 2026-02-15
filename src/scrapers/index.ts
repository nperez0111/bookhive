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
  } catch {
    return {
      success: false,
      message: "Error searching for books",
      data: null,
    } as const;
  }
}
