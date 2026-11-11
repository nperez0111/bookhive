import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { FlatList } from "react-native";
import AuthorBooksScreen from "../../app/explore/authors/[author]";
import GenreBooksScreen from "../../app/explore/genres/[genre]";
import { DiscoveryBooksScreen } from "../DiscoveryBooksScreen";

let mockLanguage = "en";
let mockParams = { author: "Le Guin", genre: "Fantasy" };
let mockQuery: any;
const mockAuthorBooks = jest.fn<any, unknown[]>(() => mockQuery);
const mockGenreBooks = jest.fn<any, unknown[]>(() => mockQuery);
jest.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => true, back: jest.fn(), navigate: jest.fn() }),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/context/language", () => ({
  useLanguage: () => ({ preferredLanguage: mockLanguage }),
}));
jest.mock("@/context/auth", () => ({ getBaseUrl: () => "https://bookhive.test" }));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useAuthorBooks: (...args: unknown[]) => mockAuthorBooks(...args),
  useGenreBooks: (...args: unknown[]) => mockGenreBooks(...args),
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#fff" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/AnimatedListItem", () => ({
  AnimatedListItem: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/GradientView", () => ({
  GradientView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/BookCard", () => ({
  BookCard: ({ title }: { title: string }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    return React.createElement(
      jest.requireActual<typeof import("react-native")>("react-native").Text,
      null,
      title,
    );
  },
}));
jest.mock("@/components/QueryErrorHandler", () => ({
  QueryErrorHandler: ({ error, onRetry }: { error: Error; onRetry: () => void }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const { View, Text, Pressable } =
      jest.requireActual<typeof import("react-native")>("react-native");
    return React.createElement(
      View,
      null,
      React.createElement(Text, null, error.message),
      React.createElement(
        Pressable,
        { onPress: onRetry },
        React.createElement(Text, null, "Retry"),
      ),
    );
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockParams = { author: "Le Guin", genre: "Fantasy" };
  mockQuery = {
    data: {
      pages: [{ books: [{ id: "bk_one", title: "Earthsea", authors: "Le Guin" }], totalBooks: 42 }],
    },
    isLoading: false,
    error: null,
    hasNextPage: true,
    isFetching: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
  };
});

test("author uses server total while genre uses loaded unique count and more indicator", () => {
  const author = render(<AuthorBooksScreen />);
  expect(author.getByText("42 books")).toBeTruthy();
  expect(mockAuthorBooks).toHaveBeenLastCalledWith("Le Guin", "en");
  author.unmount();
  mockQuery.data.pages.push(mockQuery.data.pages[0]);
  const genre = render(<GenreBooksScreen />);
  expect(genre.getByText("1+ books")).toBeTruthy();
  expect(mockGenreBooks).toHaveBeenLastCalledWith("Fantasy", "en");
  mockQuery.hasNextPage = false;
  genre.rerender(<GenreBooksScreen />);
  expect(genre.getByText("1 books")).toBeTruthy();
});

test.each([AuthorBooksScreen, GenreBooksScreen])(
  "keeps cards on page failure and selects the correct retry",
  (Screen) => {
    mockQuery.error = new Error("Page failed");
    mockQuery.isFetchNextPageError = true;
    const view = render(<Screen />);
    expect(view.getByText("Earthsea")).toBeTruthy();
    fireEvent.press(view.getByText("Retry"));
    expect(mockQuery.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(mockQuery.refetch).not.toHaveBeenCalled();
    mockQuery.isFetchNextPageError = false;
    view.rerender(<Screen />);
    fireEvent.press(view.getByText("Retry"));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
    mockQuery.data = undefined;
    view.rerender(<Screen />);
    expect(view.queryByText("Earthsea")).toBeNull();
    fireEvent.press(view.getByText("Retry"));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(2);
  },
);

test.each([AuthorBooksScreen, GenreBooksScreen])(
  "keeps the back header available during loading and initial errors",
  (Screen) => {
    mockQuery.data = undefined;
    mockQuery.isLoading = true;
    const view = render(<Screen />);
    expect(view.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(view.queryByText("0 books")).toBeNull();
    mockQuery.isLoading = false;
    mockQuery.error = new Error("Initial request failed");
    view.rerender(<Screen />);
    expect(view.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(view.queryByText("0 books")).toBeNull();
    fireEvent.press(view.getByText("Retry"));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  },
);

test("does not request an image proxy URL for books with no artwork", () => {
  const view = render(<GenreBooksScreen />);
  // The presentation boundary must send the same missing-cover value as search.
  const card = view.UNSAFE_getByType(jest.requireMock("@/components/BookCard").BookCard);
  expect(card.props.imageUri).toBe("");
});

test("does not show a successful empty state beside a failed empty-page refresh", () => {
  const view = render(
    <DiscoveryBooksScreen
      title="Fantasy"
      countLabel="0 books"
      resetKey="Fantasy"
      books={[]}
      hasData
      isLoading={false}
      error={new Error("Refresh failed")}
      hasNextPage={false}
      isFetching={false}
      isFetchingNextPage={false}
      isFetchNextPageError={false}
      refetch={jest.fn()}
      fetchNextPage={jest.fn()}
    />,
  );
  expect(view.queryByText("No books found for this selection.")).toBeNull();
  expect(view.getByText("Refresh failed")).toBeTruthy();
});

test.each([AuthorBooksScreen, GenreBooksScreen])(
  "guards load more while fetching and remounts the list on language or route change",
  (Screen) => {
    const view = render(<Screen />);
    fireEvent.press(view.getByText("Load more"));
    expect(mockQuery.fetchNextPage).toHaveBeenCalledTimes(1);
    mockQuery.isFetching = true;
    mockQuery.isFetchingNextPage = true;
    view.rerender(<Screen />);
    fireEvent.press(view.getByText("Loading…"));
    expect(mockQuery.fetchNextPage).toHaveBeenCalledTimes(1);
    const previousList = view.UNSAFE_getByType(FlatList).instance;
    mockLanguage = "fr";
    view.rerender(<Screen />);
    expect(view.UNSAFE_getByType(FlatList).instance).not.toBe(previousList);
    const languageList = view.UNSAFE_getByType(FlatList).instance;
    mockParams = { author: "Borges", genre: "Mystery" };
    view.rerender(<Screen />);
    expect(view.UNSAFE_getByType(FlatList).instance).not.toBe(languageList);
  },
);
