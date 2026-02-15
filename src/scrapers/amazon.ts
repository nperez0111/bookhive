// // Warning: This is AI slop, translated from https://github.com/janeczku/calibre-web/blob/master/cps/metadata_provider/amazon.py
// import { load } from "cheerio";
// import type { Logger } from "pino"; // Assuming winston for logging

// // Type definitions
// interface MetaSourceInfo {
//   id: string;
//   description: string;
//   link: string;
// }

// interface BookResult {
//   title: string;
//   authors: string[];
//   source: MetaSourceInfo;
//   url: string;
//   publisher: string;
//   publishedDate: string;
//   id: string | null;
//   tags: string[];
//   description?: string;
//   rating?: number;
//   cover?: string;
// }

// const AMAZON_FETCH_HEADERS = {
//   "upgrade-insecure-requests": "1",
//   "user-agent":
//     "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
//   accept:
//     "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,*/*;q=0.8",
//   "Sec-Fetch-Site": "same-origin",
//   "Sec-Fetch-Mode": "navigate",
//   "Sec-Fetch-User": "?1",
//   "Sec-Fetch-Dest": "document",
//   "Upgrade-Insecure-Requests": "1",
//   "Alt-Used": "www.amazon.com",
//   Priority: "u=0, i",
//   "accept-encoding": "gzip, deflate, br, zstd",
//   "accept-language": "en-US,en;q=0.9",
// } as const;

// class Amazon {
//   public static readonly NAME = "Amazon";
//   private static readonly ID = "amazon";
//   private readonly active: boolean;
//   private readonly logger: Logger;

//   constructor(logger: Logger, active: boolean = true) {
//     this.active = active;
//     this.logger = logger;
//   }

//   private async fetchBookDetails(
//     link: string,
//     index: number,
//   ): Promise<[BookResult, number] | null> {
//     try {
//       const response = await fetch(`https://www.amazon.com${link}`, {
//         headers: AMAZON_FETCH_HEADERS,
//       });
//       if (!response.ok) throw new Error(response.statusText);
//       const html = await response.text();
//       const $ = load(html);
//       const productDiv = $(
//         'div[cel_widget_id="dpx-ppd_csm_instrumentation_wrapper"]',
//       );

//       if (!productDiv.length) {
//         return null;
//       }

//       const match: BookResult = {
//         title: "",
//         authors: [],
//         source: {
//           id: Amazon.ID,
//           description: "Amazon Books",
//           link: "https://amazon.com/",
//         },
//         url: `https://www.amazon.com${link}`,
//         publisher: "",
//         publishedDate: "",
//         id: null,
//         tags: [],
//       };

//       // Get description
//       const description = $('div[data-feature-name="bookDescription"]')
//         .text()
//         .replace(/\xa0/g, " ")
//         .trim();

//       if (!description) {
//         return null;
//       }
//       match.description = description;

//       // Get title
//       match.title = $("#productTitle").text().trim();

//       // Find all spans with class "author"
//       productDiv.find("span.author a").each((_, authorSpan) => {
//         // Get all text nodes within the span
//         const textNodes = $(authorSpan)
//           .contents()
//           .toArray()
//           .filter((node) => node.type === "text")
//           .map((node) => $(node).text().trim())
//           .filter(
//             (text) =>
//               text !== "" &&
//               text !== " " &&
//               text !== "\n" &&
//               !text.startsWith("{"),
//           );

//         // Take the first valid text node if it exists
//         if (textNodes.length > 0) {
//           match.authors.push(textNodes[0]);
//         }
//       });

//       // Get rating
//       const ratingText = $(".a-icon-alt").first().text();
//       match.rating = ratingText
//         ? parseInt(ratingText.split(" ")[0].split(".")[0])
//         : 0;

//       // Get cover
//       const coverImg = $("img.a-dynamic-image").first();
//       match.cover = coverImg.attr("src") || "";

//       return [match, index];
//     } catch (error) {
//       this.logger.error("Error fetching book details:", error);
//       return null;
//     }
//   }

//   async search(
//     query: string,
//     _genericCover: string = "",
//     _locale: string = "en",
//   ): Promise<BookResult[]> {
//     if (!this.active) {
//       return [];
//     }

//     try {
//       // Search for books
//       const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=digital-text&sprefix=${encodeURIComponent(query)}%2Cdigital-text&ref=nb_sb_noss`;
//       const response = await fetch(searchUrl, {
//         headers: AMAZON_FETCH_HEADERS,
//       });
//       if (!response.ok) throw new Error(response.statusText);
//       const html = await response.text();
//       const $ = load(html);

//       // Get book links
//       const links = $('div[data-component-type="s-search-result"]')
//         .map((_, el) => {
//           const link = $(el)
//             .find("a")
//             .filter((_, a) => !!$(a).attr("href")?.includes("digital-text"))
//             .first()
//             .attr("href");
//           return link;
//         })
//         .get()
//         .slice(0, 3);

//       // Fetch book details in parallel
//       const results = await Promise.all(
//         links.map((link, index) => this.fetchBookDetails(link, index)),
//       );

//       // Filter out nulls and sort by original index
//       return results
//         .filter((result): result is [BookResult, number] => result !== null)
//         .sort(([, a], [, b]) => a - b)
//         .map(([record]) => record);
//     } catch (error) {
//       this.logger.error("Error searching Amazon:", error);
//       return [];
//     }
//   }
// }

// export default Amazon;
