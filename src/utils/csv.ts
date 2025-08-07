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
  });

  return new TransformStream<Uint8Array, GoodreadsBook>({
    transform(chunk, controller) {
      parser.write(chunk);

      // Process any records that are ready
      let record: GoodreadsBook;
      while ((record = parser.read() as GoodreadsBook)) {
        controller.enqueue(record);
      }
    },
    flush(controller) {
      parser.end();

      // Get any remaining records
      let record: GoodreadsBook;
      while ((record = parser.read() as GoodreadsBook)) {
        controller.enqueue(record);
      }
    },
  });
}
