import { parse } from "csv-parse";

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
    columns: true, // Use first line as column headers
    // Add error handling options
    skip_records_with_error: true,
    skip_records_with_empty_values: false,
    relax_column_count: true, // Allow inconsistent column counts
    relax_quotes: true, // Be more lenient with quotes
    cast: (value: string, { column }): any => {
      // Handle empty values
      if (value === "" || value === '""') {
        if (column === "Star Rating") return 0;
        if (column === "Read Count") return 0;
        if (column === "Owned?") return false;
        return null;
      }

      // Remove surrounding quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      // Handle different columns appropriately
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

        // Process any records that are ready
        let record: any;
        while ((record = parser.read())) {
          // Validate the record before enqueueing
          if (record && record["Title"] && record["Authors"]) {
            // Map CSV columns to StorygraphBook interface
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
              strongCharacterDevelopment:
                record["Strong Character Development?"] || "",
              loveableCharacters: record["Loveable Characters?"] || "",
              diverseCharacters: record["Diverse Characters?"] || "",
              flawedCharacters: record["Flawed Characters?"] || "",
              starRating: record["Star Rating"] || 0,
              review: record["Review"] || "",
              contentWarnings: record["Content Warnings"] || "",
              contentWarningDescription:
                record["Content Warning Description"] || "",
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
        // Continue processing other chunks instead of crashing
      }
    },
    flush(controller) {
      try {
        parser.end();

        // Get any remaining records
        let record: any;
        while ((record = parser.read())) {
          // Validate the record before enqueueing
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
              strongCharacterDevelopment:
                record["Strong Character Development?"] || "",
              loveableCharacters: record["Loveable Characters?"] || "",
              diverseCharacters: record["Diverse Characters?"] || "",
              flawedCharacters: record["Flawed Characters?"] || "",
              starRating: record["Star Rating"] || 0,
              review: record["Review"] || "",
              contentWarnings: record["Content Warnings"] || "",
              contentWarningDescription:
                record["Content Warning Description"] || "",
              tags: record["Tags"] || "",
              owned: record["Owned?"] || false,
            };
            controller.enqueue(storygraphBook);
          } else {
            console.warn(
              "Skipping invalid StoryGraph record during flush:",
              record,
            );
          }
        }
      } catch (error) {
        console.warn("Error during StoryGraph CSV parser flush:", error);
        // Don't crash, just log the error
      }
    },
  });
}

export function getGoodreadsCsvParser() {
  const parser = parse({
    skip_empty_lines: true,
    trim: true,
    from: 2,
    columns: [
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
    ],
    cast: (value: string, { column }): any => {
      // First handle the quoted values
      if (value.startsWith('="') && value.endsWith('"')) {
        value = value.slice(2, -1);
      }

      // Handle different columns appropriately
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
    // Add error handling options
    skip_records_with_error: true,
    skip_records_with_empty_values: false,
    relax_column_count: true, // Allow inconsistent column counts
    relax_quotes: true, // Be more lenient with quotes
  });

  return new TransformStream<Uint8Array, GoodreadsBook>({
    transform(chunk, controller) {
      try {
        parser.write(chunk);

        // Process any records that are ready
        let record: GoodreadsBook;
        while ((record = parser.read() as GoodreadsBook)) {
          // Validate the record before enqueueing
          if (record && record.title && record.author) {
            controller.enqueue(record);
          } else {
            console.warn("Skipping invalid Goodreads record:", record);
          }
        }
      } catch (error) {
        console.warn("Error processing CSV chunk:", error);
        // Continue processing other chunks instead of crashing
      }
    },
    flush(controller) {
      try {
        parser.end();

        // Get any remaining records
        let record: GoodreadsBook;
        while ((record = parser.read() as GoodreadsBook)) {
          // Validate the record before enqueueing
          if (record && record.title && record.author) {
            controller.enqueue(record);
          } else {
            console.warn(
              "Skipping invalid Goodreads record during flush:",
              record,
            );
          }
        }
      } catch (error) {
        console.warn("Error during CSV parser flush:", error);
        // Don't crash, just log the error
      }
    },
  });
}
