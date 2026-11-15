import { act, renderHook } from "@testing-library/react-native";
import { useReviewDraft } from "../useReviewDraft";

it("preserves intentional clearing until canonical review changes", async () => {
  const { result, rerender } = await renderHook(
    ({ review }: { review: string | undefined }) => useReviewDraft(review),
    { initialProps: { review: "Original" as string | undefined } },
  );
  expect(result.current.text).toBeNull();
  await act(() => result.current.change(""));
  await rerender({ review: "Original" });
  expect(result.current.value).toBe("");
  expect(result.current.text).toBe("");
  await rerender({ review: "Changed elsewhere" });
  expect(result.current.value).toBe("Changed elsewhere");
  expect(result.current.text).toBeNull();
  await act(() => result.current.change("New draft"));
  await rerender({ review: undefined });
  expect(result.current.value).toBe("");
  expect(result.current.text).toBeNull();
});
