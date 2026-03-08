import RichtextBuilder from "@atcute/bluesky-richtext-builder";
import type { SessionClient } from "../auth/client";
import { BOOK_STATUS } from "../constants";

export type CrossPostParams = {
  title: string;
  /** Tab-separated authors string */
  authors: string;
  status?: string;
  stars?: number;
  review?: string;
  bookUrl: string;
};

// Status values are full lexicon URIs (e.g. "buzz.bookhive.defs#finished")
const STATUS_PHRASES: Record<string, string> = {
  [BOOK_STATUS.FINISHED]: "Finished reading",
  [BOOK_STATUS.READING]: "Currently reading",
  [BOOK_STATUS.WANTTOREAD]: "Want to read",
  [BOOK_STATUS.ABANDONED]: "Abandoned",
  [BOOK_STATUS.OWNED]: "Added to my collection",
};

export function buildCrossPostText(params: CrossPostParams) {
  const { title, authors, status, stars, review, bookUrl } = params;
  const authorList = authors.split("\t").join(", ");
  const phrase = (status && STATUS_PHRASES[status]) ?? "Added to BookHive";
  const starsStr = stars
    ? " " + "⭐".repeat(Math.min(5, Math.round(stars / 2)))
    : "";
  const reviewPart = review
    ? `\n\n"${review.slice(0, 200)}${review.length > 200 ? "..." : ""}"`
    : "";

  const rt = new RichtextBuilder()
    .addText(`${phrase} "${title}" by ${authorList}${starsStr}${reviewPart} on BookHive:\n\n`)
    .addLink(bookUrl, bookUrl as `${string}:${string}`);

  return rt.build();
}

/**
 * Creates an app.bsky.feed.post on the user's PDS and returns the AT-URI, or null on failure.
 * If `customText` is provided it is used as-is (user-edited preview); facets are recalculated
 * by locating `bookUrl` within the final text.
 */
export async function createBlueskyPost(
  agent: SessionClient,
  params: CrossPostParams & { customText?: string },
): Promise<string | null> {
  let text: string;
  let facets: ReturnType<typeof buildCrossPostText>["facets"] | undefined;

  if (params.customText) {
    // Re-derive facets from the custom text by finding the URL
    const rt = new RichtextBuilder();
    const urlIndex = params.customText.indexOf(params.bookUrl);
    if (urlIndex >= 0) {
      rt.addText(params.customText.slice(0, urlIndex))
        .addLink(params.bookUrl, params.bookUrl as `${string}:${string}`)
        .addText(params.customText.slice(urlIndex + params.bookUrl.length));
    } else {
      rt.addText(params.customText);
    }
    const built = rt.build();
    text = built.text;
    facets = built.facets.length > 0 ? built.facets : undefined;
  } else {
    const built = buildCrossPostText(params);
    text = built.text;
    facets = built.facets.length > 0 ? built.facets : undefined;
  }

  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    ...(facets ? { facets } : {}),
  };

  const res = await agent.post("com.atproto.repo.createRecord", {
    input: {
      repo: agent.did,
      collection: "app.bsky.feed.post",
      record,
    },
  });

  if (!res.ok) return null;
  return (res.data as { uri: string }).uri ?? null;
}
