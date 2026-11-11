import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import SearchScreen from "../../app/search";
import LibraryScreen from "../../app/library";
import { router } from "expo-router";
import { FlatList } from "react-native";

let mockQuery: any;
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), canGoBack: jest.fn(() => true), back: jest.fn(), navigate: jest.fn() },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-document-picker", () => ({}));
jest.mock("expo-haptics", () => ({}));
jest.mock("@/utils/sharePersonalBook", () => ({ sharePersonalBook: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#fff" }));
jest.mock("@/context/language", () => ({ useLanguage: () => ({ preferredLanguage: "en" }) }));
jest.mock("@/context/auth", () => ({
  authSession: { capture: () => ({}) },
  getBaseUrl: () => "https://bookhive.test",
}));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  ...Object.fromEntries(
    [
      "useAddToPersonalShelf",
      "useCreatePersonalShelf",
      "useDeletePersonalBook",
      "useDeletePersonalShelf",
      "useDeleteSyncDocument",
      "useDismissSyncDocument",
      "useLinkPersonalBook",
      "useLinkSyncDocument",
      "usePersonalShelves",
      "useRemoveFromPersonalShelf",
      "useRenameSyncDocument",
      "useSyncDocuments",
      "useUnlinkPersonalBook",
      "useUpdatePersonalShelf",
      "useUploadPersonalBook",
    ].map((name) => [name, () => ({ data: [], mutate: jest.fn(), refetch: jest.fn() })]),
  ),
  useSearchBooks: () => ({ ...mockQuery, data: mockQuery.data.pages[0].books }),
  usePersonalLibrary: () => mockQuery,
  storageFromLibrary: () => null,
}));
jest.mock("@/components/AnimatedListItem", () => ({
  AnimatedListItem: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/ActionSheet", () => ({ ActionSheet: () => null }));
jest.mock("@/components/BookSearchModal", () => ({ BookSearchModal: () => null }));
jest.mock("@/components/TextPromptModal", () => ({ TextPromptModal: () => null }));
jest.mock("@/components/StorageMeter", () => ({ StorageMeter: () => null }));
jest.mock("@/components/ProgressBar", () => ({ ProgressBar: () => null }));
jest.mock("@/components/BackNavigationHeader", () => ({
  BackNavigationHeader: ({ onBackPress }: { onBackPress: () => void }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return React.createElement(
      Pressable,
      { accessibilityRole: "button", accessibilityLabel: "Back", onPress: onBackPress },
      React.createElement(Text, null, "Back"),
    );
  },
}));
jest.mock("@/components/PersonalBookCard", () => ({
  PersonalBookCard: ({ book }: { book: { title: string } }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    return React.createElement(
      jest.requireActual<typeof import("react-native")>("react-native").Text,
      null,
      book.title,
    );
  },
}));
jest.mock("@/components/QueryErrorHandler", () => ({
  QueryErrorHandler: ({ onRetry }: { onRetry: () => void }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    return React.createElement(
      jest.requireActual<typeof import("react-native")>("react-native").Text,
      { onPress: onRetry },
      "Retry page",
    );
  },
}));

beforeEach(() => {
  mockQuery = {
    data: {
      pages: [
        {
          total: 1,
          books: [{ id: "bk_one", contentHash: "hash", title: "Earthsea", authors: "Le Guin" }],
        },
      ],
    },
    error: null,
    isLoading: false,
    isDebouncing: false,
    hasNextPage: true,
    isFetching: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  };
});

test.each([SearchScreen, LibraryScreen])(
  "keeps loaded books and routes retries in %p",
  (Screen) => {
    const view = render(<Screen />);
    if (Screen === SearchScreen)
      fireEvent.changeText(
        view.getByLabelText("Search catalogue by title, author or ISBN"),
        "Earthsea",
      );
    expect(view.getByText("Earthsea")).toBeTruthy();
    mockQuery.isFetching = true;
    view.rerender(<Screen />);
    fireEvent.press(view.getByText("Load more"));
    expect(mockQuery.fetchNextPage).not.toHaveBeenCalled();
    mockQuery.isFetching = false;
    mockQuery.error = new Error("Page failed");
    mockQuery.isFetchNextPageError = true;
    view.rerender(<Screen />);
    expect(view.getByText("Earthsea")).toBeTruthy();
    expect(view.queryByText("Load more")).toBeNull();
    // Library may also show the unfiltered count query's error in its header.
    fireEvent.press(view.getAllByText("Retry page").at(-1)!);
    expect(mockQuery.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(mockQuery.refetch).not.toHaveBeenCalled();
    mockQuery.isFetchNextPageError = false;
    view.rerender(<Screen />);
    fireEvent.press(view.getAllByText("Retry page").at(-1)!);
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  },
);

test("search retains its controls while results scroll and allows first-tap navigation with a keyboard", () => {
  const view = render(<SearchScreen />);
  fireEvent.changeText(
    view.getByLabelText("Search catalogue by title, author or ISBN"),
    "Earthsea",
  );
  const list = view.UNSAFE_getByType(FlatList);
  expect(list.props.keyboardShouldPersistTaps).toBe("handled");
  expect(list.props.keyboardDismissMode).toBe("on-drag");
  expect(view.getByText("1+ results")).toBeTruthy();
  expect(view.getByText("Book language: en")).toBeTruthy();
  fireEvent.press(view.getByText("Earthsea"));
  expect(router.push).toHaveBeenCalledWith("/book/bk_one");
  fireEvent.press(view.getByRole("button", { name: "Clear search" }));
  expect(view.getByText("Find your next book, or one you already read.")).toBeTruthy();
  fireEvent.press(view.getByRole("button", { name: "Back" }));
  expect(router.back).toHaveBeenCalled();
});

test("search hides stale counts and page actions while the next query debounces", () => {
  const view = render(<SearchScreen />);
  fireEvent.changeText(
    view.getByLabelText("Search catalogue by title, author or ISBN"),
    "Earthsea",
  );
  expect(view.getByText("Book language: en")).toBeTruthy();
  expect(view.getByText("1+ results")).toBeTruthy();
  mockQuery.isDebouncing = true;
  view.rerender(<SearchScreen />);
  fireEvent.changeText(view.getByLabelText("Search catalogue by title, author or ISBN"), "Dune");
  expect(view.queryByText("1+ results")).toBeNull();
  expect(view.queryByText("Load more")).toBeNull();
  expect(view.queryByText("Earthsea")).toBeNull();
  expect(view.getByText("Searching for books...")).toBeTruthy();
});
