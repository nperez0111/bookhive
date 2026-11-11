import { act, renderHook } from "@testing-library/react-native";
import { useReviewDraft } from "../useReviewDraft";

it("preserves intentional clearing until canonical review changes", () => {
  const { result, rerender } = renderHook(
    ({ review }: { review: string | undefined }) => useReviewDraft(review),
    { initialProps: { review: "Original" as string | undefined } },
  );
  expect(result.current.text).toBeNull();
  act(() => result.current.change(""));
  rerender({ review: "Original" });
  expect(result.current.value).toBe("");
  expect(result.current.text).toBe("");
  rerender({ review: "Changed elsewhere" });
  expect(result.current.value).toBe("Changed elsewhere");
  expect(result.current.text).toBeNull();
  act(() => result.current.change("New draft"));
  rerender({ review: undefined });
  expect(result.current.value).toBe("");
  expect(result.current.text).toBeNull();
});
