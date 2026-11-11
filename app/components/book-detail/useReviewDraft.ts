import { useState } from "react";

/** Keep explicit review clearing distinct from an untouched canonical review. */
export function useReviewDraft(review: string | undefined) {
  const source = review ?? "";
  const [draft, setDraft] = useState<{ source: string; text: string | null }>({
    source,
    text: null,
  });
  if (draft.source !== source) {
    setDraft({ source, text: null });
  }
  return {
    text: draft.text,
    value: draft.text ?? source,
    change: (text: string | null) => setDraft({ source, text }),
  };
}
