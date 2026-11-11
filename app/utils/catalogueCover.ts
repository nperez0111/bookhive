type CatalogueCover = {
  cover?: string | null;
  thumbnail?: string | null;
};

/** Public catalogue cards only. Private ebook covers use personalCoverSource. */
export function catalogueCoverUrl(baseUrl: string, book: CatalogueCover): string {
  const image = book.cover || book.thumbnail;
  return image ? `${baseUrl}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${image}` : "";
}
