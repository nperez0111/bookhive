import { catalogueCoverUrl } from "../catalogueCover";

const origin = "https://books.example";
const prefix = `${origin}/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/`;

test("catalogue cards prefer the cover and preserve the existing proxy transform", () => {
  const cover = "https://covers.example/book.jpg?edition=2&size=large";
  expect(catalogueCoverUrl(origin, { cover, thumbnail: "thumbnail.jpg" })).toBe(
    `${prefix}${cover}`,
  );
});

test("catalogue cards fall back to the thumbnail for missing or empty covers", () => {
  for (const cover of [undefined, null, ""]) {
    expect(catalogueCoverUrl(origin, { cover, thumbnail: "thumbnail.jpg" })).toBe(
      `${prefix}thumbnail.jpg`,
    );
  }
});

test("missing catalogue images produce no request URL", () => {
  for (const book of [{}, { cover: null }, { cover: "", thumbnail: "" }]) {
    expect(catalogueCoverUrl(origin, book)).toBe("");
  }
});

test("the caller supplies the API origin without consulting a live session", () => {
  expect(catalogueCoverUrl("http://127.0.0.1:5199", { cover: "cover.jpg" })).toBe(
    "http://127.0.0.1:5199/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/cover.jpg",
  );
});
