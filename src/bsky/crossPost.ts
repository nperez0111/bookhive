import { BOOK_STATUS } from "../constants";

export type CrossPostParams = {
  title: string;
  /** Tab-separated authors string */
  authors: string;
  status?: string;
  stars?: number;
  review?: string;
  bookUrl: string;
  /** Book genres (from hive_book_genre or hive_book.genres) for BookSky routing */
  genres?: string[];
};

// BookSky genre emoji routing — emoji must be adjacent to 📚 to register on the sub-feed
const BOOKSKY_GENRE_EMOJI: Array<[pattern: RegExp, emoji: string]> = [
  [/sci.?fi|science fiction|space opera|cyberpunk|dystopia/i, "🪐📚"],
  [/romance|romantic/i, "🌶️📚"],
  [/horror|gothic|dark fiction/i, "🩸📚"],
  [/mystery|thriller|crime|detective/i, "🔍📚"],
  [/fantasy/i, "🐉📚"],
  [/non.?fiction|biography|memoir|history|self.?help/i, "📖📚"],
];

function bookSkyGenreEmoji(genres: string[]): string | null {
  for (const genre of genres) {
    for (const [re, emoji] of BOOKSKY_GENRE_EMOJI) {
      if (re.test(genre)) return emoji;
    }
  }
  return null;
}

// Status values are full lexicon URIs (e.g. "buzz.bookhive.defs#finished")
const STATUS_PHRASES: Record<string, string> = {
  [BOOK_STATUS.FINISHED]: "Finished reading",
  [BOOK_STATUS.READING]: "Currently reading",
  [BOOK_STATUS.WANTTOREAD]: "Want to read",
  [BOOK_STATUS.ABANDONED]: "Abandoned",
};

export function buildCrossPostText(params: CrossPostParams): { text: string } {
  const { title, authors, status, stars, review, bookUrl, genres } = params;
  const authorList = authors.split("\t").join(", ");
  const phrase = (status && STATUS_PHRASES[status]) ?? "Added to BookHive";
  const starsStr = stars ? " " + "⭐".repeat(Math.min(5, Math.round(stars / 2))) : "";
  const reviewPart = review
    ? `\n\n"${review.slice(0, 200)}${review.length > 200 ? "..." : ""}"`
    : "";

  const genreEmoji = genres ? bookSkyGenreEmoji(genres) : null;
  const bookSkyTags = `${genreEmoji ? genreEmoji + " " : ""}📚💙 #booksky`;

  const text = `${phrase} "${title}" by ${authorList}${starsStr}${reviewPart} on BookHive:\n\n${bookUrl} ${bookSkyTags}`;
  return { text };
}
