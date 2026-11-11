import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { ProfileBookSection } from "../ProfileBookSection";
import type { UserBook } from "../../../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";

const books: UserBook[] = Array.from({ length: 5 }, (_, index) => ({
  hiveId: `bk_${index}`,
  title: `Book ${index}`,
  authors: "A Writer",
  thumbnail: "",
  createdAt: "2026-10-24T00:00:00Z",
  userDid: "did:plc:reader",
  stars: 9,
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.buzz" }));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));

beforeEach(() => jest.clearAllMocks());

it("formats catalogue authors without blank entries or splitting a surname comma", () => {
  render(
    <ProfileBookSection
      books={[{ ...books[0], authors: " Le Guin, Ursula \t \t Another Writer " }]}
      title="Books"
      accessibilityLabel="View shelf"
      status="reading"
      did="did:plc:reader"
    />,
  );
  expect(screen.getByText("Le Guin, Ursula, Another Writer")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Book 0" }).props.accessibilityLabel).toBeUndefined();
});

it.each(["reading", "wantToRead", "finished"] as const)(
  "opens the complete %s shelf for the displayed reader while bounding the preview",
  (status) => {
    render(
      <ProfileBookSection
        books={books}
        title="Books"
        accessibilityLabel="View shelf"
        status={status}
        did="did:plc:reader"
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Book \d$/ })).toHaveLength(3);
    expect(screen.getAllByText("4.5")).toHaveLength(3);
    expect(screen.getByText("5 books")).toBeTruthy();
    expect(screen.getByText("See all")).toBeTruthy();
    expect(screen.queryByText("Book 3")).toBeNull();
    fireEvent.press(screen.getByLabelText("View shelf"));
    expect(router.push).toHaveBeenLastCalledWith(`/books/${status}?did=did:plc:reader`);
    fireEvent.press(screen.getByRole("button", { name: "Book 0" }));
    expect(router.push).toHaveBeenLastCalledWith("/book/bk_0");
  },
);

it("omits an empty public shelf without presenting management controls", () => {
  render(
    <ProfileBookSection
      books={[]}
      title="Books"
      accessibilityLabel="View shelf"
      status="reading"
      did="did:plc:reader"
    />,
  );
  expect(screen.toJSON()).toBeNull();
});
