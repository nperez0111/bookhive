import { parse as parseCsvSync } from "csv-parse/sync";
import { parse } from "csv-parse";
import { BOOK_STATUS, type BookStatus } from "../constants";
import { displayRatingToStars } from "./rating";

/** Validate the header before permissive row parsers can silently skip every row. */
export function csvHeaderProblem(
  csv: ArrayBuffer,
  requiredHeaders: string[],
  source: string,
): string | null {
  let headers: string[] | undefined;
  try {
    [headers] = parseCsvSync(new Uint8Array(csv), {
      to: 1,
      bom: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch {
    return `This file is not a valid ${source} CSV export. Export your library again and upload the CSV file.`;
  }
  const missing = requiredHeaders.filter((header) => !headers?.includes(header));
  return missing.length
    ? `This file is not a ${source} CSV export: missing ${missing.join(", ")} columns. Choose the matching import service or upload a fresh export.`
    : null;
}

export interface GoodreadsBook {
  bookId: string;
  title: string;
  author: string;
  authorLastFirst: string;
  additionalAuthors: string[];
  isbn: string;
  isbn13: string;
  myRating: number;
  averageRating: number;
  publisher: string;
  binding: string;
  numberOfPages: number;
  yearPublished: number;
  originalPublicationYear: number;
  dateRead: Date | null;
  dateAdded: Date;
  bookshelves: string[];
  bookshelvesWithPositions: string;
  exclusiveShelf: string;
  myReview: string;
  spoiler: boolean;
  privateNotes: string;
  readCount: number;
  ownedCopies: number;
}

export interface StorygraphBook {
  title: string;
  authors: string;
  contributors: string;
  isbn: string;
  format: string;
  readStatus: string;
  dateAdded: Date | null;
  lastDateRead: Date | null;
  datesRead: string;
  readCount: number;
  moods: string;
  pace: string;
  characterOrPlot: string;
  strongCharacterDevelopment: string;
  loveableCharacters: string;
  diverseCharacters: string;
  flawedCharacters: string;
  starRating: number;
  review: string;
  contentWarnings: string;
  contentWarningDescription: string;
  tags: string;
  owned: boolean;
}

export function getStorygraphCsvParser() {
  const parser = parse({
    skip_empty_lines: true,
    trim: true,
    columns: true,
    skip_records_with_error: true,
    skip_records_with_empty_values: false,
    relax_column_count: true,
    relax_quotes: true,
    cast: (value: string, { column }): any => {
      if (value === "" || value === '""') {
        if (column === "Star Rating") return 0;
        if (column === "Read Count") return 0;
        if (column === "Owned?") return false;
        return null;
      }

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      switch (column) {
        case "Star Rating":
          // StoryGraph uses 0-5 scale, multiply by 2 to match Goodreads 0-10 scale internally
          return parseFloat(value) || 0;
        case "Read Count":
          return parseInt(value) || 0;
        case "Date Added":
        case "Last Date Read":
          // StoryGraph uses YYYY/MM/DD format
          return value && value !== '""' ? new Date(value) : null;
        case "Owned?":
          return value.toLowerCase() === "yes";
        default:
          return value || "";
      }
    },
  });

  return new TransformStream<Uint8Array, StorygraphBook>({
    transform(chunk, controller) {
      try {
        parser.write(chunk);

        let record: any;
        while ((record = parser.read())) {
          if (record && record["Title"] && record["Authors"]) {
            const storygraphBook: StorygraphBook = {
              title: record["Title"] || "",
              authors: record["Authors"] || "",
              contributors: record["Contributors"] || "",
              isbn: record["ISBN/UID"] || "",
              format: record["Format"] || "",
              readStatus: record["Read Status"] || "",
              dateAdded: record["Date Added"],
              lastDateRead: record["Last Date Read"],
              datesRead: record["Dates Read"] || "",
              readCount: record["Read Count"] || 0,
              moods: record["Moods"] || "",
              pace: record["Pace"] || "",
              characterOrPlot: record["Character- or Plot-Driven?"] || "",
              strongCharacterDevelopment: record["Strong Character Development?"] || "",
              loveableCharacters: record["Loveable Characters?"] || "",
              diverseCharacters: record["Diverse Characters?"] || "",
              flawedCharacters: record["Flawed Characters?"] || "",
              starRating: record["Star Rating"] || 0,
              review: record["Review"] || "",
              contentWarnings: record["Content Warnings"] || "",
              contentWarningDescription: record["Content Warning Description"] || "",
              tags: record["Tags"] || "",
              owned: record["Owned?"] || false,
            };
            controller.enqueue(storygraphBook);
          } else {
            console.warn("Skipping invalid StoryGraph record:", record);
          }
        }
      } catch (error) {
        console.warn("Error processing StoryGraph CSV chunk:", error);
      }
    },
    flush(controller) {
      try {
        parser.end();

        let record: any;
        while ((record = parser.read())) {
          if (record && record["Title"] && record["Authors"]) {
            const storygraphBook: StorygraphBook = {
              title: record["Title"] || "",
              authors: record["Authors"] || "",
              contributors: record["Contributors"] || "",
              isbn: record["ISBN/UID"] || "",
              format: record["Format"] || "",
              readStatus: record["Read Status"] || "",
              dateAdded: record["Date Added"],
              lastDateRead: record["Last Date Read"],
              datesRead: record["Dates Read"] || "",
              readCount: record["Read Count"] || 0,
              moods: record["Moods"] || "",
              pace: record["Pace"] || "",
              characterOrPlot: record["Character- or Plot-Driven?"] || "",
              strongCharacterDevelopment: record["Strong Character Development?"] || "",
              loveableCharacters: record["Loveable Characters?"] || "",
              diverseCharacters: record["Diverse Characters?"] || "",
              flawedCharacters: record["Flawed Characters?"] || "",
              starRating: record["Star Rating"] || 0,
              review: record["Review"] || "",
              contentWarnings: record["Content Warnings"] || "",
              contentWarningDescription: record["Content Warning Description"] || "",
              tags: record["Tags"] || "",
              owned: record["Owned?"] || false,
            };
            controller.enqueue(storygraphBook);
          } else {
            console.warn("Skipping invalid StoryGraph record during flush:", record);
          }
        }
      } catch (error) {
        console.warn("Error during StoryGraph CSV parser flush:", error);
      }
    },
  });
}

export function getGoodreadsCsvParser() {
  const columns = [
    "bookId",
    "title",
    "author",
    "authorLastFirst",
    "additionalAuthors",
    "isbn",
    "isbn13",
    "myRating",
    "averageRating",
    "publisher",
    "binding",
    "numberOfPages",
    "yearPublished",
    "originalPublicationYear",
    "dateRead",
    "dateAdded",
    "bookshelves",
    "bookshelvesWithPositions",
    "exclusiveShelf",
    "myReview",
    "spoiler",
    "privateNotes",
    "readCount",
    "ownedCopies",
  ];
  const columnsWithoutAverageRating = columns.filter((column) => column !== "averageRating");

  const parser = parse({
    skip_empty_lines: true,
    trim: true,
    columns: (headers: string[]) =>
      headers.includes("Average Rating") ? columns : columnsWithoutAverageRating,
    cast: (value: string, { column }): any => {
      if (value.startsWith('="') && value.endsWith('"')) {
        value = value.slice(2, -1);
      }

      switch (column) {
        case "bookId":
          return value;
        case "myRating":
        case "numberOfPages":
        case "yearPublished":
        case "originalPublicationYear":
        case "readCount":
        case "ownedCopies":
          return parseInt(value) || 0;
        case "averageRating":
          return parseFloat(value) || 0;
        case "dateRead":
        case "dateAdded":
          return value ? new Date(value) : null;
        case "additionalAuthors":
        case "bookshelves":
          return value ? value.split(", ").filter(Boolean) : [];
        case "spoiler":
          return value.toLowerCase() === "true";
        default:
          return value;
      }
    },
    skip_records_with_error: true,
    skip_records_with_empty_values: false,
    relax_column_count: true,
    relax_quotes: true,
  });

  return new TransformStream<Uint8Array, GoodreadsBook>({
    transform(chunk, controller) {
      try {
        parser.write(chunk);

        let record: GoodreadsBook;
        while ((record = parser.read() as GoodreadsBook)) {
          if (record && record.title && record.author) {
            record.averageRating ??= 0;
            controller.enqueue(record);
          } else {
            console.warn("Skipping invalid Goodreads record:", record);
          }
        }
      } catch (error) {
        console.warn("Error processing CSV chunk:", error);
      }
    },
    flush(controller) {
      try {
        parser.end();

        let record: GoodreadsBook;
        while ((record = parser.read() as GoodreadsBook)) {
          if (record && record.title && record.author) {
            record.averageRating ??= 0;
            controller.enqueue(record);
          } else {
            console.warn("Skipping invalid Goodreads record during flush:", record);
          }
        }
      } catch (error) {
        console.warn("Error during CSV parser flush:", error);
      }
    },
  });
}

export interface HardcoverBook {
  title: string;
  author: string;
  series: string;
  status: BookStatus;
  privacy: string;
  hardcoverBookId: string;
  hardcoverEditionId: string;
  isbn10: string;
  isbn13: string;
  asin: string;
  media: string;
  countryCode: string;
  languageCode: string;
  binding: string;
  pages: number;
  durationInSeconds: number;
  publishDate: Date | null;
  publisher: string;
  genres: string;
  moods: string;
  tags: string;
  contentWarnings: string;
  lists: string;
  dateAdded: Date | null;
  dateStarted: Date | null;
  dateFinished: Date | null;
  rating: number;
  review: string;
  reviewContainsSpoilers: boolean;
  sponsoredReview: boolean;
  reviewDate: Date | null;
  reviewUrl: string;
  reviewMediaUrl: string;
  privateNotes: string;
  owned: boolean;
  compilation: boolean;
  reviewSlate: string;
}

function get(record: Record<string, string>, key: string): string {
  return record[key] || "";
}

function parseDate(date: string): Date | null {
  const newDate = new Date(date);
  if (isNaN(newDate.getTime())) return null;
  return newDate;
}

function parseBoolean(input: string): boolean {
  return input.toLowerCase() === "true";
}

/**
 * Hardcover shelf name (or an already-mapped lexicon ref) → status.
 *
 * Matching is done on the lowercased input against lowercased refs: the refs
 * are camelCase (`…#wantToRead`), so comparing a lowercased input against the
 * constant directly could never match, and a re-imported BookHive export fell
 * through to the `dateFinished` guess.
 */
function parseStatus(status: string, dateFinished: Date | null): BookStatus {
  const key = status.toLowerCase();
  const asRef = Object.values(BOOK_STATUS).find((ref) => ref.toLowerCase() === key);
  if (asRef) return asRef;

  switch (key) {
    case "read":
      return BOOK_STATUS.FINISHED;
    case "currently reading":
      return BOOK_STATUS.READING;
    case "want to read":
      return BOOK_STATUS.WANTTOREAD;
    // Hardcover's "did not finish" shelf.
    case "stopped":
      return BOOK_STATUS.ABANDONED;
    default:
      return dateFinished ? BOOK_STATUS.FINISHED : BOOK_STATUS.WANTTOREAD;
  }
}

export function parseHardcoverRecord(record: Record<string, string>): HardcoverBook {
  const dateFinished = parseDate(get(record, "Date Finished"));
  return {
    title: get(record, "Title"),
    author: get(record, "Author"),
    series: get(record, "Series"),
    status: parseStatus(get(record, "Status"), dateFinished),
    privacy: get(record, "Privacy"),
    hardcoverBookId: get(record, "Hardcover Book ID"),
    hardcoverEditionId: get(record, "Hardcover Edition ID"),
    isbn10: get(record, "ISBN 10").replace(/[-\s]/g, ""),
    isbn13: get(record, "ISBN 13").replace(/[-\s]/g, ""),
    asin: get(record, "ASIN"),
    media: get(record, "Media"),
    countryCode: get(record, "Country Code"),
    languageCode: get(record, "Language Code"),
    binding: get(record, "Binding"),
    pages: parseInt(get(record, "Pages")) || 0,
    durationInSeconds: parseInt(get(record, "Duration in Seconds")) || 0,
    publishDate: parseDate(get(record, "Publish Date")),
    publisher: get(record, "Publisher"),
    genres: get(record, "Genres"),
    moods: get(record, "Moods"),
    tags: get(record, "Tags"),
    contentWarnings: get(record, "Content Warnings"),
    lists: get(record, "Lists"),
    dateAdded: parseDate(get(record, "Date Added")),
    dateStarted: parseDate(get(record, "Date Started")),
    dateFinished,
    // Hardcover rates 1-5; `user_book.stars` is 1-10.
    rating: displayRatingToStars(parseFloat(get(record, "Rating"))) || 0,
    review: get(record, "Review"),
    reviewContainsSpoilers: parseBoolean(get(record, "Review Contains Spoilers")),
    sponsoredReview: parseBoolean(get(record, "Sponsored Review")),
    reviewDate: parseDate(get(record, "Review Date")),
    reviewUrl: get(record, "Review URL"),
    reviewMediaUrl: get(record, "Review Media URL"),
    privateNotes: get(record, "Private Notes"),
    owned: parseBoolean(get(record, "Owned")),
    compilation: get(record, "Compilation").toLowerCase() === "yes",
    reviewSlate: get(record, "Review Slate"),
  };
}

export function getHardcoverCsvParser() {
  const parser = parse({
    columns: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    skip_records_with_error: true,
    trim: true,
    // all coercion and parsing logic is handled in parseHardcoverRecord,
    // this is merely to ensure everything is a string without wrapping quotes
    cast: (value?: string): string => {
      if (!value) return "";
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      return value;
    },
  });

  return new TransformStream<Uint8Array, HardcoverBook>({
    transform(chunk, controller) {
      try {
        parser.write(chunk);

        let record: Record<string, string> | undefined;
        while ((record = parser.read())) {
          if (record) {
            const parsedRecord = parseHardcoverRecord(record);
            if (parsedRecord.title !== "" && parsedRecord.author !== "") {
              controller.enqueue(parsedRecord);
              continue;
            }
          }
          console.warn("Skipping invalid Hardcover record:", record);
        }
      } catch (error) {
        console.warn("Error processing CSV chunk:", error);
      }
    },
    flush(controller) {
      try {
        parser.end();

        let record: any;
        while ((record = parser.read())) {
          if (record && "Title" in record && "Author" in record) {
            controller.enqueue(parseHardcoverRecord(record));
          } else {
            console.warn("Skipping invalid Hardcover record during flush:", record);
          }
        }
      } catch (error) {
        console.warn("Error during CSV parser flush:", error);
      }
    },
  });
}
