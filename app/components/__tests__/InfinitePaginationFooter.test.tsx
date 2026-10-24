import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { InfinitePaginationFooter } from "../InfinitePaginationFooter";

jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#fff" }));
jest.mock("@/components/QueryErrorHandler", () => ({
  QueryErrorHandler: ({ onRetry }: { onRetry: () => void }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return React.createElement(Text, { onPress: onRetry }, "Retry");
  },
}));

function props() {
  return {
    error: null as Error | null,
    isFetchNextPageError: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: true,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  };
}

test("renders nothing when exhausted and uses caller labels for loading and load more", () => {
  const state = props();
  const view = render(<InfinitePaginationFooter {...state} hasNextPage={false} />);
  expect(view.toJSON()).toBeNull();
  view.rerender(<InfinitePaginationFooter {...state} loadMoreLabel="More authors" />);
  fireEvent.press(view.getByText("More authors"));
  expect(state.fetchNextPage).toHaveBeenCalledTimes(1);
  view.rerender(
    <InfinitePaginationFooter {...state} isFetchingNextPage loadingLabel="Fetching authors" />,
  );
  expect(view.getByText("Fetching authors")).toBeTruthy();
});

test.each([
  { isFetching: true, isFetchingNextPage: false },
  { isFetching: true, isFetchingNextPage: true },
  { isFetching: false, isFetchingNextPage: true },
])("blocks loading more during any fetch: %j", (flags) => {
  const state = props();
  const view = render(<InfinitePaginationFooter {...state} {...flags} />);
  const button = view.getByRole("button");
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(state.fetchNextPage).not.toHaveBeenCalled();
});

test.each([true, false])("error retry selects failed next page: %s", (isFetchNextPageError) => {
  const state = props();
  const view = render(
    <InfinitePaginationFooter
      {...state}
      error={new Error("Page failed")}
      isFetchNextPageError={isFetchNextPageError}
    />,
  );
  expect(view.queryByText("Load more")).toBeNull();
  fireEvent.press(view.getByText("Retry"));
  expect(state.fetchNextPage).toHaveBeenCalledTimes(isFetchNextPageError ? 1 : 0);
  expect(state.refetch).toHaveBeenCalledTimes(isFetchNextPageError ? 0 : 1);
});
