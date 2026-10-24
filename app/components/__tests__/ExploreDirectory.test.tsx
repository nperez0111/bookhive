import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { useAuthorDirectory } from "@/hooks/useAuthorDirectory";
import ExploreScreen from "../../app/(tabs)/explore";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock("@/components/ui/TabBarBackground", () => ({ useBottomTabOverflow: () => 0 }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));
jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#ffffff" }));
jest.mock("@/context/language", () => ({ useLanguage: () => ({ preferredLanguage: "en" }) }));
jest.mock("@/hooks/useAuthorDirectory", () => ({ useAuthorDirectory: jest.fn() }));
jest.mock("@/hooks/useBookhiveQuery", () => ({
  useExplore: () => ({ data: { genres: [], topAuthors: [] }, genreDirectory: {} }),
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
});

describe("Explore author directory", () => {
  it("discloses the bounded directory, offers search/load more, and links existing author detail", () => {
    const state = directory();
    directoryMock.mockReturnValue(state);
    const screen = render(<ExploreScreen />);
    fireEvent.press(screen.getByText("Browse author directory"));
    expect(screen.getByText(/top 500 eligible authors/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Search author directory"), "Le Guin");
    expect(directoryMock).toHaveBeenLastCalledWith("Le Guin", "en", true);
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
    fireEvent.press(screen.getByText("Browse author directory"));
    expect(screen.queryByText("Load more authors")).toBeNull();
    directoryMock.mockReturnValue({ ...state, error: new Error("Stale query failed") });
    screen.rerender(<ExploreScreen />);
    expect(screen.queryByText("Retry directory")).toBeNull();
    expect(screen.getByText("Ursula K. Le Guin")).toBeTruthy();
  });
});
