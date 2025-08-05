import { describe, it, expect } from "vitest";
import { getGoodreadsCsvParser, getStorygraphCsvParser } from "./csv";

describe("CSV Parsers", () => {
  describe("Goodreads CSV Parser", () => {
    it("should parse basic Goodreads CSV data correctly", async () => {
      // Note: Goodreads parser expects data starting from line 2 (skips header) and uses commas
      const csvData = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
18143945,Europe in Autumn,Dave Hutchinson,"Hutchinson, Dave",,,,0,3.71,Solaris,Paperback,429,2014,2014,,2025/02/21,to-read,"to-read (#171)",to-read,,,,0,0
36510196,Old Man's War,John Scalzi,"Scalzi, John",,,,5,4.23,Tor Books,Kindle Edition,318,2007,2005,2024/12/15,2025/02/14,read,"read (#1)",read,Great book!,false,,1,1`;

      const parser = getGoodreadsCsvParser();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(csvData));
          controller.close();
        },
      });

      const books = [];
      const reader = stream.pipeThrough(parser).getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        books.push(value);
      }

      expect(books).toHaveLength(2);

      // Test first book (to-read)
      expect(books[0]).toMatchObject({
        bookId: "18143945",
        title: "Europe in Autumn",
        author: "Dave Hutchinson",
        myRating: 0,
        averageRating: 3.71,
        publisher: "Solaris",
        numberOfPages: 429,
        yearPublished: 2014,
        originalPublicationYear: 2014,
        dateRead: null,
        exclusiveShelf: "to-read",
        bookshelves: ["to-read"],
        spoiler: false,
        readCount: 0,
        ownedCopies: 0,
      });

      // Test second book (read with rating and review)
      expect(books[1]).toMatchObject({
        bookId: "36510196",
        title: "Old Man's War",
        author: "John Scalzi",
        myRating: 5,
        averageRating: 4.23,
        publisher: "Tor Books",
        numberOfPages: 318,
        yearPublished: 2007,
        originalPublicationYear: 2005,
        exclusiveShelf: "read",
        myReview: "Great book!",
        spoiler: false,
        readCount: 1,
        ownedCopies: 1,
      });

      expect(books[1].dateRead).toBeInstanceOf(Date);
      expect(books[1].dateAdded).toBeInstanceOf(Date);
    });

    it("should handle arrays and bookshelves correctly", async () => {
      const csvData = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
123,Test Book,Author Name,"Name, Author","Co-Author, Second Author",,,4,4.5,Test Publisher,Paperback,300,2024,2024,2024/01/15,2024/01/01,"read, favorites","read (#1), favorites (#5)",read,Great book!,false,Private note,1,1`;

      const parser = getGoodreadsCsvParser();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(csvData));
          controller.close();
        },
      });

      const books = [];
      const reader = stream.pipeThrough(parser).getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        books.push(value);
      }

      expect(books).toHaveLength(1);
      expect(books[0]).toMatchObject({
        bookId: "123",
        title: "Test Book",
        author: "Author Name",
        authorLastFirst: "Name, Author",
        additionalAuthors: ["Co-Author", "Second Author"],
        myRating: 4,
        averageRating: 4.5,
        bookshelves: ["read", "favorites"],
        exclusiveShelf: "read",
        myReview: "Great book!",
        spoiler: false,
        privateNotes: "Private note",
      });
    });
  });

  describe("StoryGraph CSV Parser", () => {
    it("should parse basic StoryGraph CSV data correctly", async () => {
      const csvData = `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?
Nemesis Games,James S. A. Corey,"",9780316217590,digital,read,2017/12/13,"","",1,"",,,,,,,4.0,,"",,"",No
Artificial Condition,Martha Wells,"","",audio,read,2021/08/31,2021/01/05,2021/01/05,1,"",,,,,,,,,"",,"",No
Where the Axe Is Buried,Ray Nayler,"",9780374615369,hardcover,to-read,2025/04/14,"","",0,"",,,,,,,,,"",,"",No`;

      const parser = getStorygraphCsvParser();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(csvData));
          controller.close();
        },
      });

      const books = [];
      const reader = stream.pipeThrough(parser).getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        books.push(value);
      }

      expect(books).toHaveLength(3);

      // Test first book (read with rating)
      expect(books[0]).toMatchObject({
        title: "Nemesis Games",
        authors: "James S. A. Corey",
        contributors: "",
        isbn: "9780316217590",
        format: "digital",
        readStatus: "read",
        starRating: 4.0,
        readCount: 1,
        owned: false,
        review: "",
        lastDateRead: null,
      });

      expect(books[0].dateAdded).toBeInstanceOf(Date);
      expect(books[0].dateAdded?.getFullYear()).toBe(2017);

      // Test second book (read with last date read)
      expect(books[1]).toMatchObject({
        title: "Artificial Condition",
        authors: "Martha Wells",
        isbn: "",
        format: "audio",
        readStatus: "read",
        starRating: 0,
        readCount: 1,
        owned: false,
      });

      expect(books[1].lastDateRead).toBeInstanceOf(Date);
      expect(books[1].lastDateRead?.getFullYear()).toBe(2021);

      // Test third book (to-read)
      expect(books[2]).toMatchObject({
        title: "Where the Axe Is Buried",
        authors: "Ray Nayler",
        isbn: "9780374615369",
        format: "hardcover",
        readStatus: "to-read",
        starRating: 0,
        readCount: 0,
        owned: false,
        lastDateRead: null,
      });
    });

    it("should handle empty values and different read statuses correctly", async () => {
      const csvData = `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?
Test Book,Test Author,"","",ebook,currently-reading,2024/01/01,"","",2,fast,slow,character,yes,yes,no,yes,3.5,"Great so far!",violence,"Some violence",sci-fi,Yes`;

      const parser = getStorygraphCsvParser();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(csvData));
          controller.close();
        },
      });

      const books = [];
      const reader = stream.pipeThrough(parser).getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        books.push(value);
      }

      expect(books).toHaveLength(1);

      // Test book with various filled fields
      expect(books[0]).toMatchObject({
        title: "Test Book",
        authors: "Test Author",
        readStatus: "currently-reading",
        starRating: 3.5,
        readCount: 2,
        review: "Great so far!",
        moods: "fast",
        pace: "slow",
        characterOrPlot: "character",
        strongCharacterDevelopment: "yes",
        contentWarnings: "violence",
        contentWarningDescription: "Some violence",
        tags: "sci-fi",
        owned: true,
      });
    });


  });
});