/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { LexiconDoc, Lexicons } from "@atproto/lexicon";

export const schemaDict = {
  BuzzBookhiveBook: {
    lexicon: 1,
    id: "buzz.bookhive.book",
    defs: {
      main: {
        type: "record",
        key: "tid",
        description: "A book in the user's library",
        record: {
          type: "object",
          required: ["title", "authors", "hiveId", "createdAt"],
          properties: {
            title: {
              type: "string",
              description: "The title of the book",
              minLength: 1,
              maxLength: 512,
            },
            authors: {
              type: "string",
              description: "The authors of the book (tab separated)",
              minLength: 1,
              maxLength: 2048,
            },
            hiveId: {
              type: "string",
              description:
                "The book's hive id, used to correlate user's books with the hive",
            },
            createdAt: {
              type: "string",
              format: "datetime",
            },
            startedAt: {
              type: "string",
              format: "datetime",
              description: "The date the user started reading the book",
            },
            finishedAt: {
              type: "string",
              format: "datetime",
              description: "The date the user finished reading the book",
            },
            cover: {
              type: "blob",
              description: "Cover image of the book",
              accept: ["image/png", "image/jpeg"],
              maxSize: 1000000,
            },
            status: {
              type: "string",
              knownValues: [
                "buzz.bookhive.defs#finished",
                "buzz.bookhive.defs#reading",
                "buzz.bookhive.defs#wantToRead",
                "buzz.bookhive.defs#abandoned",
                "buzz.bookhive.defs#owned",
              ],
            },
            stars: {
              type: "integer",
              description:
                "Number of stars given to the book (1-10) which will be mapped to 1-5 stars",
              minimum: 1,
              maximum: 10,
            },
            review: {
              type: "string",
              description: "The book's review",
              maxGraphemes: 15000,
            },
          },
        },
      },
    },
  },
  BuzzBookhiveDefs: {
    lexicon: 1,
    id: "buzz.bookhive.defs",
    defs: {
      finished: {
        type: "token",
        description: "User has finished reading the book",
      },
      reading: {
        type: "token",
        description: "User is currently reading the book",
      },
      wantToRead: {
        type: "token",
        description: "User wants to read the book",
      },
      abandoned: {
        type: "token",
        description: "User has abandoned the book",
      },
      owned: {
        type: "token",
        description: "User owns the book",
      },
    },
  },
  BuzzBookhiveHiveBook: {
    lexicon: 1,
    id: "buzz.bookhive.hiveBook",
    defs: {
      main: {
        type: "record",
        key: "tid",
        description: "A book within the hive",
        record: {
          type: "object",
          required: [
            "id",
            "title",
            "authors",
            "createdAt",
            "updatedAt",
            "thumbnail",
          ],
          properties: {
            title: {
              type: "string",
              description: "The title of the book",
              minLength: 1,
              maxLength: 512,
            },
            authors: {
              type: "string",
              description: "The authors of the book (tab separated)",
              minLength: 1,
              maxLength: 512,
            },
            id: {
              type: "string",
              description:
                "The book's hive id, used to correlate user's books with the hive",
            },
            source: {
              type: "string",
              description: "The source service name (e.g. Goodreads)",
            },
            sourceUrl: {
              type: "string",
              description: "URL to the book on the source service",
            },
            sourceId: {
              type: "string",
              description: "ID of the book in the source service",
            },
            cover: {
              type: "string",
              description: "URL to full-size cover image",
            },
            thumbnail: {
              type: "string",
              description: "URL to thumbnail image",
            },
            description: {
              type: "string",
              description: "Book description/summary",
              maxLength: 5000,
            },
            rating: {
              type: "integer",
              description: "Average rating (0-1000)",
              minimum: 0,
              maximum: 1000,
            },
            ratingsCount: {
              type: "integer",
              description: "Number of ratings",
            },
            createdAt: {
              type: "string",
              format: "datetime",
            },
            updatedAt: {
              type: "string",
              format: "datetime",
            },
          },
        },
      },
    },
  },
  BuzzBookhiveSearchBooks: {
    lexicon: 1,
    id: "buzz.bookhive.searchBooks",
    defs: {
      main: {
        type: "query",
        description:
          "Find books matching the search criteria. Requires authentication.",
        parameters: {
          type: "params",
          required: ["q"],
          properties: {
            q: {
              type: "string",
              description:
                "Search query string. Will be matched against title and authors fields.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 25,
            },
            offset: {
              type: "integer",
              description: "Offset for pagination into the result set",
            },
            id: {
              type: "string",
              description: "The ID of the book within the hive.",
            },
          },
        },
        output: {
          encoding: "application/json",
          schema: {
            type: "object",
            required: ["books"],
            properties: {
              offset: {
                type: "integer",
                description:
                  "The next offset to use for pagination (result of limit + offset)",
              },
              books: {
                type: "array",
                items: {
                  type: "ref",
                  ref: "lex:buzz.bookhive.hiveBook#record",
                },
              },
            },
          },
        },
      },
    },
  },
  ComAtprotoRepoStrongRef: {
    lexicon: 1,
    id: "com.atproto.repo.strongRef",
    description: "A URI with a content-hash fingerprint.",
    defs: {
      main: {
        type: "object",
        required: ["uri", "cid"],
        properties: {
          uri: {
            type: "string",
            format: "at-uri",
          },
          cid: {
            type: "string",
            format: "cid",
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>;

export const schemas = Object.values(schemaDict);
export const lexicons: Lexicons = new Lexicons(schemas);
export const ids = {
  BuzzBookhiveBook: "buzz.bookhive.book",
  BuzzBookhiveDefs: "buzz.bookhive.defs",
  BuzzBookhiveHiveBook: "buzz.bookhive.hiveBook",
  BuzzBookhiveSearchBooks: "buzz.bookhive.searchBooks",
  ComAtprotoRepoStrongRef: "com.atproto.repo.strongRef",
};
