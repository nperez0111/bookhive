import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { HomeShelvesSection } from "../HomeShelvesSection";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));

beforeEach(() => jest.clearAllMocks());

it("keeps both shelf creation entry points available for an empty collection", () => {
  const onCreatePress = jest.fn();
  render(<HomeShelvesSection shelves={[]} onCreatePress={onCreatePress} />);
  fireEvent.press(screen.getByLabelText("Create shelf"));
  fireEvent.press(screen.getByText("No shelves yet"));
  expect(onCreatePress).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByLabelText("See all shelves"));
  expect(router.push).toHaveBeenLastCalledWith("/lists");
  const row = screen.getByLabelText("Create your first shelf");
  expect(row).toHaveStyle({ minHeight: 80 });
  expect(
    screen.getByText("Create a shelf to curate your books").props.numberOfLines,
  ).toBeUndefined();
});

it("uses public AT-URI navigation and keeps creation alongside populated shelves", () => {
  const onCreatePress = jest.fn();
  const uri = "at://did:plc:reader/social.popfeed.feed.list/favourites";
  render(
    <HomeShelvesSection
      shelves={[
        { uri, name: "Favourites", itemCount: 1 },
        { uri: `${uri}2`, name: "Next up", itemCount: 2 },
      ]}
      onCreatePress={onCreatePress}
    />,
  );
  expect(screen.getByText("1 book")).toBeTruthy();
  expect(screen.getByText("2 books")).toBeTruthy();
  fireEvent.press(screen.getByText("Favourites"));
  expect(router.push).toHaveBeenLastCalledWith(`/lists/${encodeURIComponent(uri)}`);
  fireEvent.press(screen.getByText("New Shelf"));
  expect(onCreatePress).toHaveBeenCalledTimes(1);
});
