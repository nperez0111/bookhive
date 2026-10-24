/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";
import { ReadingHistory } from "../ReadingHistory";

jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "#123456" }));

it("does not fabricate prior reads", () => {
  render(<ReadingHistory />);
  expect(screen.queryByText("Reading history")).toBeNull();
});

it("shows accessible dated prior reads in API order, including missing start dates", () => {
  render(
    <ReadingHistory
      previousReads={[
        { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-02-02T00:00:00.000Z" },
        { finishedAt: "2025-06-03T00:00:00.000Z" },
      ]}
    />,
  );
  expect(screen.getByRole("header", { name: "Reading history" })).toBeTruthy();
  expect(
    screen.getByLabelText("Previous read 1. Started Jan 1, 2026. Finished Feb 2, 2026."),
  ).toBeTruthy();
  expect(screen.getByLabelText("Previous read 2. Finished Jun 3, 2025.")).toBeTruthy();
});

it("shows API progress entries independently, preserving zero and exact page counts", () => {
  render(
    <ReadingHistory
      progressHistory={[
        { createdAt: "2026-10-23T00:00:00.000Z", currentPage: 657, totalPages: 658, percent: 100 },
        { createdAt: "2026-10-22T00:00:00.000Z", percent: 0 },
      ]}
    />,
  );
  expect(screen.getByText("Recent progress")).toBeTruthy();
  expect(screen.getByLabelText("Oct 23, 2026: 657 of 658 pages · 100%")).toBeTruthy();
  expect(screen.getByLabelText("Oct 22, 2026: 0%")).toBeTruthy();
});
