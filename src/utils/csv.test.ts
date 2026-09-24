import { describe, it, expect } from "bun:test";
import { getGoodreadsCsvParser, getHardcoverCsvParser, getStorygraphCsvParser } from "./csv";
import { HARDCOVER_CSV } from "../workers/import/__fixtures__/hardcover-csv";

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

      expect(books[1]!.dateRead).toBeInstanceOf(Date);
      expect(books[1]!.dateAdded).toBeInstanceOf(Date);
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

    it("should parse Goodreads exports when Average Rating column is absent", async () => {
      const csvData = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
456,Future Reading,Example Author,"Author, Example",Second Author,"=""0123456789""","=""9780123456789""",0,Test Publisher,Hardcover,250,2024,2024,,2026/06/07,to-read,to-read (#158),to-read,,,,0,0`;

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
        bookId: "456",
        title: "Future Reading",
        author: "Example Author",
        authorLastFirst: "Author, Example",
        additionalAuthors: ["Second Author"],
        isbn: "0123456789",
        isbn13: "9780123456789",
        myRating: 0,
        averageRating: 0,
        publisher: "Test Publisher",
        binding: "Hardcover",
        numberOfPages: 250,
        yearPublished: 2024,
        originalPublicationYear: 2024,
        dateRead: null,
        bookshelves: ["to-read"],
        bookshelvesWithPositions: "to-read (#158)",
        exclusiveShelf: "to-read",
        readCount: 0,
        ownedCopies: 0,
      });
      expect(books[0]!.dateAdded).toBeInstanceOf(Date);
      expect(books[0]!.dateAdded?.getFullYear()).toBe(2026);
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

      expect(books[0]!.dateAdded).toBeInstanceOf(Date);
      expect(books[0]!.dateAdded?.getFullYear()).toBe(2017);

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

      expect(books[1]!.lastDateRead).toBeInstanceOf(Date);
      expect(books[1]!.lastDateRead?.getFullYear()).toBe(2021);

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

  describe("Hardcover CSV Parser", () => {
    it("should parse basic Hardcover CSV data correctly", async () => {
      const csvData = HARDCOVER_CSV;
      const parser = getHardcoverCsvParser();
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

      // Test first book (want to read)
      expect(books[0]).toMatchObject({
        asin: "0374100144",
        author: "Roberto Bolaño",
        binding: "",
        compilation: false,
        contentWarnings: "",
        countryCode: "us",
        durationInSeconds: 0,
        genres: "",
        hardcoverBookId: "75726",
        hardcoverEditionId: "25012766",
        isbn10: "0374100144",
        isbn13: "9780374100148",
        languageCode: "en",
        lists: "",
        media: "Book",
        moods: "",
        owned: false,
        pages: 898,
        privacy: "Public",
        privateNotes: "",
        publisher: "Farrar, Straus and Giroux",
        rating: 0,
        review: "",
        reviewContainsSpoilers: false,
        reviewMediaUrl: "",
        reviewSlate: "{}",
        reviewUrl: "",
        series: "2666 (#1.0)",
        sponsoredReview: false,
        status: "buzz.bookhive.defs#wantToRead",
        title: "2666",
      });

      expect(books[0]!.dateAdded?.toISOString()).toBe("2025-01-15T00:00:00.000Z");
      expect(books[0]!.dateFinished).toBe(null);
      expect(books[0]!.dateStarted).toBe(null);
      expect(books[0]!.publishDate?.toISOString()).toBe("2008-11-11T00:00:00.000Z");
      expect(books[0]!.reviewDate?.toISOString()).toBe("2025-01-15T13:56:31.000Z");

      // Test second book (read with date finished)
      expect(books[1]).toMatchObject({
        asin: "B0036G94XY",
        author: "William Gibson",
        binding: "",
        compilation: false,
        contentWarnings: "",
        countryCode: "us",
        durationInSeconds: 25686,
        genres: "",
        hardcoverBookId: "2440",
        hardcoverEditionId: "31159321",
        isbn10: "",
        isbn13: "",
        languageCode: "en",
        lists: "Owned, Shelved By Genre Reading List (#19)",
        media: "Audio",
        moods: "",
        owned: true,
        pages: 191,
        privacy: "Public",
        privateNotes: "",
        publisher: "Audible Frontiers",
        rating: 9,
        review: "",
        reviewContainsSpoilers: false,
        reviewMediaUrl: "",
        reviewSlate: "{}",
        reviewUrl: "",
        series: "Sprawl (#0.0)",
        sponsoredReview: false,
        status: "buzz.bookhive.defs#finished",
        tags: "",
        title: "Burning Chrome",
      });

      expect(books[1]!.dateAdded?.toISOString()).toBe("2025-01-10T00:00:00.000Z");
      expect(books[1]!.dateFinished?.toISOString()).toBe("2025-01-23T00:00:00.000Z");
      expect(books[1]!.dateStarted?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
      expect(books[1]!.publishDate?.toISOString()).toBe("1986-04-01T00:00:00.000Z");
      expect(books[1]!.reviewDate?.toISOString()).toBe("2025-01-10T17:21:40.987Z");

      // Test third book (currently-read)
      expect(books[2]).toMatchObject({
        asin: "",
        author: "Dan Simmons",
        binding: "",
        compilation: false,
        contentWarnings: "",
        countryCode: "us",
        durationInSeconds: 0,
        genres: "",
        hardcoverBookId: "427460",
        hardcoverEditionId: "30428122",
        isbn10: "0385263481",
        isbn13: "9780385263481",
        languageCode: "en",
        lists: "Owned",
        media: "Book",
        moods: "",
        owned: true,
        pages: 492,
        privacy: "Public",
        privateNotes: "",
        publisher: "Crown",
        rating: 0,
        review: "",
        reviewContainsSpoilers: false,
        reviewMediaUrl: "",
        reviewSlate: "{}",
        reviewUrl: "",
        series: "Hyperion Cantos (#1.0)",
        sponsoredReview: false,
        status: "buzz.bookhive.defs#reading",
        tags: "",
        title: "Hyperion",
      });

      expect(books[2]!.dateAdded?.toISOString()).toBe("2025-01-31T00:00:00.000Z");
      expect(books[2]!.dateFinished).toBe(null);
      expect(books[2]!.dateStarted?.toISOString()).toBe("2023-09-01T00:00:00.000Z");
      expect(books[2]!.publishDate?.toISOString()).toBe("1989-05-26T00:00:00.000Z");
      expect(books[2]!.reviewDate?.toISOString()).toBe("2025-01-15T13:56:57.000Z");
    });

    it("should handle empty values and different read statuses correctly", async () => {
      const csvData = `
Title,Author,Series,Status,Privacy,Hardcover Book ID,Hardcover Edition ID,ISBN 10,ISBN 13,ASIN,Media,Country Code,Language Code,Binding,Pages,Duration in Seconds,Publish Date,Publisher,Genres,Moods,Tags,Content Warnings,Lists,Date Added,Date Started,Date Finished,Rating,Review,Review Contains Spoilers,Sponsored Review,Review Date,Review URL,Review Media URL,Private Notes,Owned,Compilation,Review Slate
Mistborn: The Final Empire,Brandon Sanderson,The Mistborn Saga: The Original Trilogy (#1.0),Stopped,Public,369692,30432878,0765377136,9780765377135,,Book,us,en,,541,,2006-07-17,Tor Teen,,,,,Owned,2025-01-15,2024-08-01,"",1.5,,false,false,2025-01-15T13:57:07Z,,,,true,No,{}
`;

      const parser = getHardcoverCsvParser();
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
        asin: "",
        author: "Brandon Sanderson",
        binding: "",
        compilation: false,
        contentWarnings: "",
        countryCode: "us",
        dateAdded: new Date("2025-01-15T00:00:00.000Z"),
        dateFinished: null,
        dateStarted: new Date("2024-08-01T00:00:00.000Z"),
        durationInSeconds: 0,
        genres: "",
        hardcoverBookId: "369692",
        hardcoverEditionId: "30432878",
        isbn10: "0765377136",
        isbn13: "9780765377135",
        languageCode: "en",
        lists: "Owned",
        media: "Book",
        moods: "",
        owned: true,
        pages: 541,
        privacy: "Public",
        privateNotes: "",
        publishDate: new Date("2006-07-17T00:00:00.000Z"),
        publisher: "Tor Teen",
        rating: 3,
        review: "",
        reviewContainsSpoilers: false,
        reviewDate: new Date("2025-01-15T13:57:07.000Z"),
        reviewMediaUrl: "",
        reviewSlate: "{}",
        reviewUrl: "",
        series: "The Mistborn Saga: The Original Trilogy (#1.0)",
        sponsoredReview: false,
        status: "buzz.bookhive.defs#wantToRead",
        tags: "",
        title: "Mistborn: The Final Empire",
      });
    });
  });
});
