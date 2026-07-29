import { html } from "hono/html";
import { type HtmlEscapedString } from "hono/utils/html";

/**
 * AT Tags — declare which ATProto records/identities a web page corresponds to.
 *
 * Implements the community proposal at https://tangled.org/chrisshank.com/at-tags/
 * Renders `<meta name="at:{prop}" content="{at-uri}">` tags. `<meta>` (not
 * `<link>`) is used because AT URIs are not technically valid URIs and break
 * HTML validation inside `<link>`.
 *
 * Built with hono's `html` template rather than JSX `<meta>` elements because
 * hono/jsx deduplicates head `<meta>` tags by `name`, which would collapse the
 * proposal's array semantics (e.g. multiple `at:canonical`).
 *
 * All properties follow array semantics: multiple values emit multiple tags.
 * - `canonical` — the record(s) this page *is* (deleting them removes the page)
 * - `alternate` — auxiliary record(s) referenced (page survives their deletion)
 * - `author`    — DID(s) that authored the page (content is `at://did:...`)
 * - `me`        — DID(s) that own the overall site/section (content is `at://did:...`)
 * - `custom`    — namespaced props keyed `"ns:prop"` → `name="at:ns:prop"`
 */

type MaybeList = string | null | undefined | (string | null | undefined)[];

export type AtTagsProps = {
  canonical?: MaybeList;
  alternate?: MaybeList;
  /** DID or `at://did` — bare DIDs are normalized to `at://did`. */
  author?: MaybeList;
  /** DID or `at://did` — bare DIDs are normalized to `at://did`. */
  me?: MaybeList;
  /** Namespaced custom properties. Key `"ns:prop"` → `name="at:ns:prop"`. */
  custom?: Record<string, MaybeList>;
};

/**
 * Flatten to a deduped array of non-empty strings. An optional `transform` is
 * applied before dedup so equivalent representations collapse (e.g. `did:x` and
 * `at://did:x` both normalize to `at://did:x` and yield a single value).
 */
function clean(value: MaybeList, transform?: (s: string) => string): string[] {
  const arr = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = v?.trim();
    if (s) seen.add(transform ? transform(s) : s);
  }
  return [...seen];
}

/** DIDs (`did:...`) must be expressed as AT URIs (`at://did:...`) in content. */
function toDidUri(value: string): string {
  return value.startsWith("did:") ? `at://${value}` : value;
}

export const AtTags = ({
  canonical,
  alternate,
  author,
  me,
  custom,
}: AtTagsProps): HtmlEscapedString | Promise<HtmlEscapedString> => {
  const tags: Array<{ name: string; content: string }> = [];

  for (const content of clean(canonical)) {
    tags.push({ name: "at:canonical", content });
  }
  for (const content of clean(alternate)) {
    tags.push({ name: "at:alternate", content });
  }
  for (const content of clean(author, toDidUri)) {
    tags.push({ name: "at:author", content });
  }
  for (const content of clean(me, toDidUri)) {
    tags.push({ name: "at:me", content });
  }
  if (custom) {
    for (const [key, value] of Object.entries(custom)) {
      for (const content of clean(value)) {
        tags.push({ name: `at:${key}`, content });
      }
    }
  }

  // hono renders an array of `html` fragments without re-escaping each one, and
  // the interpolations here are auto-escaped (see layout.tsx's link/meta maps).
  return html`${tags.map((t) => html`<meta name="${t.name}" content="${t.content}" />`)}`;
};
