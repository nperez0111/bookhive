/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { LexiconDoc, Lexicons } from '@atproto/lexicon'

export const schemaDict = {
  BuzzBookhiveBook: {
    lexicon: 1,
    id: 'buzz.bookhive.book',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['title', 'author', 'createdAt'],
          properties: {
            title: {
              type: 'string',
              description: 'The title of the book',
              minLength: 1,
              maxLength: 512,
            },
            author: {
              type: 'string',
              description: 'The author of the book',
              minLength: 1,
              maxLength: 512,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
            cover: {
              type: 'blob',
              description: 'Cover image of the book',
              accept: ['image/png', 'image/jpeg'],
              maxSize: 1000000,
            },
            year: {
              type: 'integer',
              description: 'Year of publication',
            },
            isbn: {
              type: 'array',
              description: 'Any ISBN numbers for editions of this book',
              items: {
                type: 'string',
                description: 'ISBN number',
                minLength: 1,
                maxLength: 32,
              },
            },
            status: {
              type: 'string',
              knownValues: [
                'buzz.bookhive.defs#finished',
                'buzz.bookhive.defs#reading',
                'buzz.bookhive.defs#wantToRead',
                'buzz.bookhive.defs#abandoned',
                'buzz.bookhive.defs#owned',
              ],
            },
          },
        },
      },
    },
  },
  BuzzBookhiveDefs: {
    lexicon: 1,
    id: 'buzz.bookhive.defs',
    defs: {
      finished: {
        type: 'token',
        description: 'User has finished reading the book',
      },
      reading: {
        type: 'token',
        description: 'User is currently reading the book',
      },
      wantToRead: {
        type: 'token',
        description: 'User wants to read the book',
      },
      abandoned: {
        type: 'token',
        description: 'User has abandoned the book',
      },
      owned: {
        type: 'token',
        description: 'User owns the book',
      },
    },
  },
  AppBskyActorProfile: {
    lexicon: 1,
    id: 'app.bsky.actor.profile',
    defs: {
      main: {
        type: 'record',
        description: 'A declaration of a Bluesky account profile.',
        key: 'literal:self',
        record: {
          type: 'object',
          properties: {
            displayName: {
              type: 'string',
              maxGraphemes: 64,
              maxLength: 640,
            },
            description: {
              type: 'string',
              description: 'Free-form profile description text.',
              maxGraphemes: 256,
              maxLength: 2560,
            },
            avatar: {
              type: 'blob',
              description:
                "Small image to be displayed next to posts from account. AKA, 'profile picture'",
              accept: ['image/png', 'image/jpeg'],
              maxSize: 1000000,
            },
            banner: {
              type: 'blob',
              description:
                'Larger horizontal image to display behind profile view.',
              accept: ['image/png', 'image/jpeg'],
              maxSize: 1000000,
            },
            labels: {
              type: 'union',
              description:
                'Self-label values, specific to the Bluesky application, on the overall account.',
              refs: ['lex:com.atproto.label.defs#selfLabels'],
            },
            joinedViaStarterPack: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
            },
            pinnedPost: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  BuzzBookhiveReview: {
    lexicon: 1,
    id: 'buzz.bookhive.review',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['createdAt', 'book'],
          properties: {
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
            book: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description: 'A reference to the book being reviewed',
            },
            stars: {
              type: 'integer',
              description:
                'Number of stars given to the book (1-10) which will be mapped to 1-5 stars',
              minimum: 1,
              maximum: 10,
            },
            comment: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description: 'A reference to a review of the book',
            },
          },
        },
      },
    },
  },
  ComAtprotoRepoStrongRef: {
    lexicon: 1,
    id: 'com.atproto.repo.strongRef',
    description: 'A URI with a content-hash fingerprint.',
    defs: {
      main: {
        type: 'object',
        required: ['uri', 'cid'],
        properties: {
          uri: {
            type: 'string',
            format: 'at-uri',
          },
          cid: {
            type: 'string',
            format: 'cid',
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>

export const schemas = Object.values(schemaDict)
export const lexicons: Lexicons = new Lexicons(schemas)
export const ids = {
  BuzzBookhiveBook: 'buzz.bookhive.book',
  BuzzBookhiveDefs: 'buzz.bookhive.defs',
  AppBskyActorProfile: 'app.bsky.actor.profile',
  BuzzBookhiveReview: 'buzz.bookhive.review',
  ComAtprotoRepoStrongRef: 'com.atproto.repo.strongRef',
}
