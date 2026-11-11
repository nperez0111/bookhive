import { useState } from "react";
import type { BookProgress } from "../../../src/types";
import {
  progressToDraft,
  progressDraftValues,
  type MetricField,
  type ProgressDraftFields,
} from "./progressDraft";

/** Draft state only. The screen retains mutation/deletion guards and save feedback. */
export function useReadingProgressDraft(progress: BookProgress | undefined) {
  // Wire object property order is not part of canonical progress identity.
  const sourceKey = JSON.stringify([
    progress?.currentPage,
    progress?.totalPages,
    progress?.currentChapter,
    progress?.totalChapters,
    progress?.percent,
    progress?.updatedAt,
  ]);
  const [draft, setDraft] = useState(() => ({ sourceKey, fields: progressToDraft(progress) }));

  // Reconcile before painting. Unrelated book updates must not reset typed inputs.
  if (draft.sourceKey !== sourceKey) {
    setDraft({ sourceKey, fields: progressToDraft(progress) });
  }

  return {
    fields: draft.fields,
    ...progressDraftValues(draft.fields),
    changeMetric: (field: MetricField, text: string) =>
      setDraft((old) => ({
        ...old,
        fields: { ...old.fields, [field]: text, manualPercentInput: null },
      })),
    changePercent: (text: string) =>
      setDraft((old) => ({ ...old, fields: { ...old.fields, manualPercentInput: text } })),
    // A failed optimistic save returns to this render's canonical source.
    restore: (fields: ProgressDraftFields) => setDraft({ sourceKey, fields }),
  };
}

export type ReadingProgressDraft = ReturnType<typeof useReadingProgressDraft>;
