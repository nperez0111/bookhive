import { objectHash, sha256base64 } from "ohash";
import type { HiveId } from "../db";

export function getHiveId({
  title,
  authors,
}: {
  title: string;
  authors: string;
}): HiveId {
  return `bk_${sha256base64(
    objectHash({
      title: title.toLowerCase(),
      author: authors.toLowerCase(),
    }),
  ).slice(0, 20)}`;
}
