import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { useAuthorDirectory } from "@/hooks/useAuthorDirectory";
import { useExplore, useLanguages } from "@/hooks/useBookhiveQuery";
import ExploreScreen from "../../app/(tabs)/explore";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { useSafeAreaInsets: () => ({ top: 0 }), SafeAreaProvider: View, SafeAreaView: View };
});
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#ffffff" }));
const mockSetLanguage = jest.fn();
jest.mock("@/context/language", () => ({
  useLanguage: () => ({ preferredLanguage: "English", setPreferredLanguage: mockSetLanguage }),
}));
jest.mock("@/hooks/useAuthorDirectory", () => ({ useAuthorDirectory: jest.fn() }));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useExplore: jest.fn(),
  useLanguages: jest.fn(),
}));
jest.mock("@/components/GradientView", () => ({
  GradientView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/FadeInImage", () => ({ FadeInImage: () => null }));
jest.mock("@/components/LanguageFilter", () => ({ LanguageFilter: () => null }));
jest.mock("@/components/SectionHeader", () => ({
  SectionHeader: ({ title }: { title: string }) =>
    jest
      .requireActual<typeof import("react")>("react")
      .createElement(
        jest.requireActual<typeof import("react-native")>("react-native").Text,
        null,
        title,
      ),
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
        React.createElement(Text, null, "Retry directory"),
      ),
    );
  },
}));

const directoryMock = useAuthorDirectory as jest.Mock;
const exploreMock = useExplore as jest.Mock;
const languagesMock = useLanguages as jest.Mock;
let mockExplore: any;
function directory() {
  return {
    authors: [{ author: "Ursula K. Le Guin", bookCount: 12 }],
    total: 51,
    isLoading: false,
    isDebouncing: false,
    hasNextPage: true,
    isFetching: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
    error: null,
    isFetchNextPageError: false,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  directoryMock.mockReturnValue(directory());
  languagesMock.mockReturnValue({ data: ["English"], refetch: jest.fn() });
  mockExplore = {
    data: {
      genres: Array.from({ length: 8 }, (_, i) => ({ genre: `Genre ${i + 1}`, count: 100 })),
      topAuthors: Array.from({ length: 8 }, (_, i) => ({
        author: `Author ${i + 1}`,
        bookCount: 10,
      })),
    },
    genreDirectory: { data: { pages: [{ genres: [{ genre: "Fantasy", count: 20 }] }] } },
    refetch: jest.fn(),
  };
  exploreMock.mockImplementation(() => mockExplore);
});

describe("Explore author directory", () => {
  it("explains empty featured selections and offers directories", () => {
    mockExplore.data = { genres: [], topAuthors: [] };
    const result = render(<ExploreScreen />);
    expect(result.getByText("No featured genres yet")).toBeTruthy();
    expect(result.getAllByText("Book results use your selected language.")).toHaveLength(1);
    expect(result.getByRole("button", { name: "Browse all genres" })).toBeTruthy();
    fireEvent.press(result.getByRole("tab", { name: "Authors" }));
    expect(result.getByText("No featured authors yet")).toBeTruthy();
    expect(result.getByRole("button", { name: "Browse author directory" })).toBeTruthy();
  });

  it.each(["loading", "fetching", "error"])(
    "does not call featured %s an empty success",
    (state) => {
      mockExplore.data = { genres: [], topAuthors: [] };
      mockExplore.isLoading = state === "loading";
      mockExplore.isFetching = state === "fetching";
      mockExplore.error = state === "error" ? new Error("Unavailable") : null;
      const result = render(<ExploreScreen />);
      expect(result.queryByText(/No featured/)).toBeNull();
      fireEvent.press(result.getByRole("tab", { name: "Authors" }));
      expect(result.queryByText(/No featured/)).toBeNull();
    },
  );

  it("only enables the genre directory while it is visible, preserving expansion", () => {
    const screen = render(<ExploreScreen />);
    expect(exploreMock).toHaveBeenLastCalledWith("English", false);
    fireEvent.press(screen.getByText("Browse all genres"));
    expect(exploreMock).toHaveBeenLastCalledWith("English", true);
    expect(screen.getByText("Fantasy")).toBeTruthy();
    expect(screen.getByText(/Directory counts include all languages/)).toBeTruthy();
    fireEvent.press(screen.getByText("Authors"));
    expect(exploreMock).toHaveBeenLastCalledWith("English", false);
    fireEvent.press(screen.getByText("Genres"));
    expect(exploreMock).toHaveBeenLastCalledWith("English", true);
    expect(screen.getByText("Show featured genres")).toBeTruthy();
  });

  it.each(["loading", "error"])(
    "keeps independent directories and language controls usable on featured %s",
    (status) => {
      mockExplore.data = undefined;
      mockExplore.isLoading = status === "loading";
      mockExplore.error = status === "error" ? new Error("Featured failed") : null;
      const screen = render(<ExploreScreen />);
      expect(screen.getByLabelText("Change discovery language")).toBeTruthy();
      fireEvent.press(screen.getByText("Browse all genres"));
      expect(screen.getByText("Fantasy")).toBeTruthy();
      expect(screen.queryByText("Featured failed")).toBeNull();
      fireEvent.press(screen.getByText("Authors"));
      fireEvent.press(screen.getByText("Browse author directory"));
      expect(screen.getByText("Ursula K. Le Guin")).toBeTruthy();
      expect(screen.queryByText("Featured failed")).toBeNull();
    },
  );

  it("does not label the old author count as matches for a debouncing search", () => {
    directoryMock.mockReturnValue({ ...directory(), total: 0, isDebouncing: true });
    const screen = render(<ExploreScreen />);
    fireEvent.press(screen.getByText("Authors"));
    fireEvent.press(screen.getByText("Browse author directory"));
    fireEvent.changeText(screen.getByLabelText("Search author directory"), "Borges");
    expect(screen.queryByText(/authors in this directory/)).toBeNull();
    expect(screen.queryByText(/No authors match/)).toBeNull();
  });

  it("shows one browse category at a time without a second page title", () => {
    directoryMock.mockReturnValue(directory());
    const screen = render(<ExploreScreen />);
    expect(screen.queryByText("Browse books")).toBeNull();
    expect(screen.getByText("Browse all genres")).toBeTruthy();
    expect(screen.getByText("Genre 6")).toBeTruthy();
    expect(screen.queryByText("Genre 7")).toBeNull();
    expect(screen.queryByText("Author 1")).toBeNull();
    expect(screen.queryByText("Browse author directory")).toBeNull();
    fireEvent.press(screen.getByText("Authors"));
    expect(screen.queryByText("Browse all genres")).toBeNull();
    expect(screen.getByText("Browse author directory")).toBeTruthy();
    expect(screen.getByText("Author 5")).toBeTruthy();
    expect(screen.queryByText("Author 6")).toBeNull();
    expect(screen.queryByText("Genre 1")).toBeNull();
    fireEvent.press(screen.getByText("Genres"));
    expect(screen.getByText("Browse all genres")).toBeTruthy();
  });
  it("opens the shared language picker with a fresh catalogue request", () => {
    directoryMock.mockReturnValue(directory());
    const screen = render(<ExploreScreen />);
    const language = () => screen.getByLabelText("Change discovery language");
    expect(language().props.accessibilityState.expanded).toBe(false);
    fireEvent.press(language());
    expect(language().props.accessibilityState.expanded).toBe(true);
    expect(languagesMock().refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: "English", checked: true })).toBeTruthy();
    fireEvent.press(screen.getByRole("radio", { name: "All Languages" }));
    expect(mockSetLanguage).toHaveBeenCalledWith(null);
    expect(language().props.accessibilityState.expanded).toBe(false);
  });
  it("retains author-directory input across category switches and disables its query while hidden", () => {
    directoryMock.mockReturnValue(directory());
    const screen = render(<ExploreScreen />);
    fireEvent.press(screen.getByText("Authors"));
    fireEvent.press(screen.getByText("Browse author directory"));
    fireEvent.changeText(screen.getByLabelText("Search author directory"), "Le Guin");
    fireEvent.press(screen.getByText("Genres"));
    expect(directoryMock).toHaveBeenLastCalledWith("Le Guin", "English", false);
    expect(screen.queryByLabelText("Search author directory")).toBeNull();
    fireEvent.press(screen.getByText("Authors"));
    expect(directoryMock).toHaveBeenLastCalledWith("Le Guin", "English", true);
    expect(screen.getByLabelText("Search author directory").props.value).toBe("Le Guin");
  });
  it("makes book search and the community feed available from Discover", () => {
    directoryMock.mockReturnValue(directory());
    const screen = render(<ExploreScreen />);
    expect(screen.getByText("Discover")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Search books"));
    expect(router.push).toHaveBeenLastCalledWith("/search");
    fireEvent.press(screen.getByLabelText("Community feed"));
    expect(router.push).toHaveBeenLastCalledWith("/feed");
  });
  it("discloses the bounded directory, offers search/load more, and links existing author detail", () => {
    const state = directory();
    directoryMock.mockReturnValue(state);
    const screen = render(<ExploreScreen />);
    fireEvent.press(screen.getByText("Authors"));
    fireEvent.press(screen.getByText("Browse author directory"));
    expect(screen.getByText(/top 500 eligible authors/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Search author directory"), "Le Guin");
    expect(directoryMock).toHaveBeenLastCalledWith("Le Guin", "English", true);
    fireEvent.press(screen.getByText("Ursula K. Le Guin"));
    expect(router.push).toHaveBeenCalledWith("/explore/authors/Ursula%20K.%20Le%20Guin");
    fireEvent.press(screen.getByText("Load more authors"));
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("keeps loaded rows visible beside a later-page error and retries that page", () => {
    const state = {
      ...directory(),
      error: new Error("Authors could not load"),
      isFetchNextPageError: true,
    };
    directoryMock.mockReturnValue(state);
    const screen = render(<ExploreScreen />);
    fireEvent.press(screen.getByText("Authors"));
    fireEvent.press(screen.getByText("Browse author directory"));
    expect(screen.getByText("Ursula K. Le Guin")).toBeTruthy();
    expect(screen.getByText("Authors could not load")).toBeTruthy();
    fireEvent.press(screen.getByText("Retry directory"));
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it("hides both retry and load-more controls during author debounce", () => {
    const state = { ...directory(), isDebouncing: true };
    directoryMock.mockReturnValue(state);
    const screen = render(<ExploreScreen />);
    fireEvent.press(screen.getByText("Authors"));
    fireEvent.press(screen.getByText("Browse author directory"));
    expect(screen.queryByText("Load more authors")).toBeNull();
    directoryMock.mockReturnValue({ ...state, error: new Error("Stale query failed") });
    screen.rerender(<ExploreScreen />);
    expect(screen.queryByText("Retry directory")).toBeNull();
    expect(screen.getByText("Ursula K. Le Guin")).toBeTruthy();
  });
});
