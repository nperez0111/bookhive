import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { HomeShelvesSection } from "../HomeShelvesSection";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("expo-router", () => ({
  useRouter: () => jest.requireMock("expo-router").router,
  router: { push: jest.fn() },
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "light" }));

beforeEach(() => jest.clearAllMocks());

it("keeps both shelf creation entry points available for an empty collection", async () => {
  const onCreatePress = jest.fn();
  await render(<HomeShelvesSection shelves={[]} onCreatePress={onCreatePress} />);
  await fireEvent.press(screen.getByLabelText("Create shelf"));
  await fireEvent.press(screen.getByText("No shelves yet"));
  expect(onCreatePress).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByLabelText("See all shelves"));
  expect(router.push).toHaveBeenLastCalledWith("/lists");
  const row = screen.getByLabelText("Create your first shelf");
  expect(row).toHaveStyle({ minHeight: 80 });
  expect(
    screen.getByText("Create a shelf to curate your books").props.numberOfLines,
  ).toBeUndefined();
});

it("uses public AT-URI navigation and keeps creation alongside populated shelves", async () => {
  const onCreatePress = jest.fn();
  const uri = "at://did:plc:reader/social.popfeed.feed.list/favourites";
  await render(
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
  await fireEvent.press(screen.getByText("Favourites"));
  expect(router.push).toHaveBeenLastCalledWith(`/lists/${encodeURIComponent(uri)}`);
  await fireEvent.press(screen.getByText("New Shelf"));
  expect(onCreatePress).toHaveBeenCalledTimes(1);
});
