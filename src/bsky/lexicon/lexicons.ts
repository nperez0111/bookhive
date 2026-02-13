/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from "@atproto/lexicon";
import { type $Typed, is$typed, maybe$typed } from "./util.js";

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
            bookProgress: {
              description: "Progress tracking details for the book",
              type: "ref",
              ref: "lex:buzz.bookhive.defs#bookProgress",
            },
          },
        },
      },
    },
  },
  BuzzBookhiveBuzz: {
    lexicon: 1,
    id: "buzz.bookhive.buzz",
    defs: {
      main: {
        type: "record",
        key: "tid",
        description: "Record containing a Bookhive comment.",
        record: {
          type: "object",
          required: ["comment", "createdAt", "book", "parent"],
          properties: {
            comment: {
              type: "string",
              maxLength: 100000,
              maxGraphemes: 10000,
              description: "The content of the comment.",
            },
            createdAt: {
              type: "string",
              format: "datetime",
              description:
                "Client-declared timestamp when this comment was originally created.",
            },
            parent: {
              type: "ref",
              ref: "lex:com.atproto.repo.strongRef",
            },
            book: {
              type: "ref",
              ref: "lex:com.atproto.repo.strongRef",
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
      review: {
        type: "object",
        required: ["review", "createdAt", "did", "handle"],
        properties: {
          review: {
            type: "string",
            description: "The review content",
          },
          createdAt: {
            type: "string",
            format: "datetime",
            description: "The date the review was created",
          },
          stars: {
            type: "integer",
            description: "The number of stars given to the book",
          },
          did: {
            type: "string",
            description: "The DID of the user who made the review",
          },
          handle: {
            type: "string",
            description: "The handle of the user who made the review",
          },
        },
      },
      comment: {
        type: "object",
        required: ["comment", "createdAt", "book", "parent", "did", "handle"],
        properties: {
          comment: {
            type: "string",
            maxLength: 100000,
            maxGraphemes: 10000,
            description: "The content of the comment.",
          },
          createdAt: {
            type: "string",
            format: "datetime",
            description:
              "Client-declared timestamp when this comment was originally created.",
          },
          parent: {
            type: "ref",
            ref: "lex:com.atproto.repo.strongRef",
          },
          book: {
            type: "ref",
            ref: "lex:com.atproto.repo.strongRef",
          },
          did: {
            type: "string",
            description: "The DID of the user who made the comment",
          },
          handle: {
            type: "string",
            description: "The handle of the user who made the comment",
          },
        },
      },
      profile: {
        type: "object",
        required: ["displayName", "handle", "booksRead", "reviews"],
        properties: {
          displayName: {
            type: "string",
          },
          handle: {
            type: "string",
          },
          avatar: {
            type: "string",
          },
          description: {
            type: "string",
          },
          booksRead: {
            type: "integer",
            minimum: 0,
          },
          reviews: {
            type: "integer",
            minimum: 0,
          },
          isFollowing: {
            type: "boolean",
            description: "Whether the authed user is following this profile",
          },
        },
      },
      activity: {
        type: "object",
        required: [
          "type",
          "createdAt",
          "hiveId",
          "title",
          "userDid",
          "userHandle",
        ],
        properties: {
          type: {
            type: "string",
            knownValues: ["review", "rated", "started", "finished"],
          },
          createdAt: {
            type: "string",
            format: "datetime",
          },
          hiveId: {
            type: "string",
            description: "The hive id of the book",
          },
          title: {
            type: "string",
            description: "The title of the book",
          },
          userDid: {
            type: "string",
            description: "The DID of the user who added the book",
          },
          userHandle: {
            type: "string",
            description: "The handle of the user who added the book",
          },
        },
      },
      userBook: {
        type: "object",
        required: [
          "userDid",
          "title",
          "authors",
          "hiveId",
          "createdAt",
          "thumbnail",
        ],
        properties: {
          userDid: {
            type: "string",
            description: "The DID of the user who added the book",
          },
          userHandle: {
            type: "string",
            description: "The handle of the user who added the book",
          },
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
            type: "string",
            description: "Cover image of the book",
          },
          thumbnail: {
            type: "string",
            description: "Cover image of the book",
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
          bookProgress: {
            description: "Progress tracking information for the book",
            type: "ref",
            ref: "lex:buzz.bookhive.defs#bookProgress",
          },
        },
      },
      bookProgress: {
        type: "object",
        description: "Reading progress tracking data",
        required: ["updatedAt"],
        properties: {
          percent: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description: "How far through the book the reader is (0-100)",
          },
          totalPages: {
            type: "integer",
            minimum: 1,
            description: "Total number of pages in the book",
          },
          currentPage: {
            type: "integer",
            minimum: 1,
            description: "Current page the user is on",
          },
          totalChapters: {
            type: "integer",
            minimum: 1,
            description: "Total number of chapters in the book",
          },
          currentChapter: {
            type: "integer",
            minimum: 1,
            description: "Current chapter the user is on",
          },
          updatedAt: {
            type: "string",
            format: "datetime",
            description: "When the progress was last updated",
          },
        },
      },
      bookIdMap: {
        type: "object",
        required: ["hiveId"],
        properties: {
          hiveId: {
            type: "string",
            description: "The hive ID for the book",
          },
          isbn: {
            type: "string",
            description: "The book ISBN identifier",
          },
          isbn13: {
            type: "string",
            description: "The book ISBN-13 identifier",
          },
          goodreadsId: {
            type: "string",
            description: "The Goodreads identifier for the book",
          },
        },
      },
    },
  },
  BuzzBookhiveGetBook: {
    lexicon: 1,
    id: "buzz.bookhive.getBook",
    defs: {
      main: {
        type: "query",
        description: "Get a book's info. Requires authentication.",
        parameters: {
          type: "params",
          required: ["id"],
          properties: {
            id: {
              type: "string",
              description: "The book's hive ID",
            },
          },
        },
        output: {
          encoding: "application/json",
          schema: {
            type: "object",
            required: ["book", "reviews", "comments"],
            properties: {
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
              bookProgress: {
                description: "Reading progress for the user",
                type: "ref",
                ref: "lex:buzz.bookhive.defs#bookProgress",
              },
              book: {
                description: "The hive book's info",
                type: "ref",
                ref: "lex:buzz.bookhive.hiveBook#record",
              },
              reviews: {
                description: "Reviews of the book",
                type: "array",
                items: {
                  type: "ref",
                  ref: "lex:buzz.bookhive.defs#review",
                },
              },
              comments: {
                description: "Comments on the book",
                type: "array",
                items: {
                  type: "ref",
                  ref: "lex:buzz.bookhive.defs#comment",
                },
              },
              activity: {
                description: "Other users' activity on the book",
                type: "array",
                items: {
                  type: "ref",
                  ref: "lex:buzz.bookhive.defs#activity",
                },
              },
            },
          },
        },
      },
    },
  },
  BuzzBookhiveGetBookIdMap: {
    lexicon: 1,
    id: "buzz.bookhive.getBookIdMap",
    defs: {
      main: {
        type: "query",
        description:
          "Resolve a book identifier map by hiveId, isbn, isbn13, or goodreadsId. Does not require authentication.",
        parameters: {
          type: "params",
          properties: {
            hiveId: {
              type: "string",
              description: "The book hive ID",
            },
            isbn: {
              type: "string",
              description: "The book ISBN identifier",
            },
            isbn13: {
              type: "string",
              description: "The book ISBN-13 identifier",
            },
            goodreadsId: {
              type: "string",
              description: "The Goodreads identifier for the book",
            },
          },
        },
        output: {
          encoding: "application/json",
          schema: {
            type: "object",
            required: ["bookIdMap"],
            properties: {
              bookIdMap: {
                type: "ref",
                ref: "lex:buzz.bookhive.defs#bookIdMap",
              },
            },
          },
        },
      },
    },
  },
  BuzzBookhiveGetProfile: {
    lexicon: 1,
    id: "buzz.bookhive.getProfile",
    defs: {
      main: {
        type: "query",
        description: "Get a profile's info. Does not require authentication.",
        parameters: {
          type: "params",
          properties: {
            did: {
              type: "string",
              description: "The user's DID to get the profile of",
            },
            handle: {
              type: "string",
              description: "The user's handle to get the profile of",
            },
          },
        },
        output: {
          encoding: "application/json",
          schema: {
            type: "object",
            required: ["books", "profile", "activity", "friendActivity"],
            properties: {
              books: {
                description: "All books in the user's library",
                type: "array",
                items: {
                  type: "ref",
                  ref: "lex:buzz.bookhive.defs#userBook",
                },
              },
              profile: {
                description: "The user's profile",
                type: "ref",
                ref: "lex:buzz.bookhive.defs#profile",
              },
              activity: {
                description: "The user's activity",
                type: "array",
                items: {
                  type: "ref",
                  ref: "lex:buzz.bookhive.defs#activity",
                },
              },
              friendActivity: {
                description: "The user's friend activity",
                type: "array",
                items: {
                  type: "ref",
                  ref: "lex:buzz.bookhive.defs#userBook",
                },
              },
            },
          },
        },
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
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[];
export const lexicons: Lexicons = new Lexicons(schemas);

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>;
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>;
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === "main" ? id : `${id}#${hash}`}" $type property`,
        ),
      };
}

export const ids = {
  BuzzBookhiveBook: "buzz.bookhive.book",
  BuzzBookhiveBuzz: "buzz.bookhive.buzz",
  BuzzBookhiveDefs: "buzz.bookhive.defs",
  BuzzBookhiveGetBook: "buzz.bookhive.getBook",
  BuzzBookhiveGetBookIdMap: "buzz.bookhive.getBookIdMap",
  BuzzBookhiveGetProfile: "buzz.bookhive.getProfile",
  BuzzBookhiveHiveBook: "buzz.bookhive.hiveBook",
  BuzzBookhiveSearchBooks: "buzz.bookhive.searchBooks",
  ComAtprotoRepoStrongRef: "com.atproto.repo.strongRef",
} as const;
