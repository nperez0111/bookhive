import { act, renderHook } from "@testing-library/react-native";
import type { BookProgress } from "../../../../src/types";
import { useReadingProgressDraft } from "../useReadingProgressDraft";

const progress: BookProgress = {
  currentPage: 10,
  totalPages: 100,
  percent: 10,
  updatedAt: "2026-10-24T00:00:00Z",
};

it("preserves edits for equal canonical progress and replaces all fields when the source changes", async () => {
  const { result, rerender } = await renderHook(
    ({ stored }: { stored: BookProgress | undefined }) => useReadingProgressDraft(stored),
    { initialProps: { stored: progress as BookProgress | undefined } },
  );
  await act(() => result.current.changeMetric("currentPageInput", "20"));
  await act(() => result.current.changeMetric("currentChapterInput", "3"));
  await act(() => result.current.changePercent("35"));
  await rerender({ stored: { ...progress } });
  expect(result.current.fields.currentPageInput).toBe("20");
  expect(result.current.percentInput).toBe("35");
  await rerender({ stored: { ...progress, currentPage: 11, percent: 11 } });
  expect(result.current.fields.currentPageInput).toBe("11");
  expect(result.current.fields.currentChapterInput).toBe("");
  expect(result.current.percentInput).toBe("11");
  await rerender({ stored: undefined });
  expect(result.current.fields).toEqual({
    currentPageInput: "",
    totalPagesInput: "",
    currentChapterInput: "",
    totalChaptersInput: "",
    manualPercentInput: null,
  });
});

it("keeps a manual blank until a page or chapter edit restores automatic calculation", async () => {
  const { result } = await renderHook(() => useReadingProgressDraft(progress));
  await act(() => result.current.changePercent(""));
  expect(result.current.percentInput).toBe("");
  await act(() => result.current.changeMetric("currentPageInput", "30"));
  expect(result.current.fields.manualPercentInput).toBeNull();
  expect(result.current.percentInput).toBe("30");
});

it("ignores wire property order but follows canonical timestamp changes", async () => {
  const { result, rerender } = await renderHook(
    ({ stored }: { stored: BookProgress }) => useReadingProgressDraft(stored),
    { initialProps: { stored: progress } },
  );
  await act(() => result.current.changeMetric("currentPageInput", "20"));
  await rerender({
    stored: {
      updatedAt: progress.updatedAt,
      percent: 10,
      totalPages: 100,
      currentPage: 10,
    },
  });
  expect(result.current.fields.currentPageInput).toBe("20");
  await rerender({ stored: { ...progress, updatedAt: "2026-10-25T00:00:00Z" } });
  expect(result.current.fields.currentPageInput).toBe("10");
});
