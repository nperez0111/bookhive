import type { BookProgress } from "../../../src/types";
import { calculatePercentFromProgressValues } from "@/utils/calculatePercentFromProgressValues";

export function progressToDraft(progress: BookProgress | undefined) {
  return {
    currentPageInput: progress?.currentPage?.toString() ?? "",
    totalPagesInput: progress?.totalPages?.toString() ?? "",
    currentChapterInput: progress?.currentChapter?.toString() ?? "",
    totalChaptersInput: progress?.totalChapters?.toString() ?? "",
    // null restores automatic calculation; "" deliberately leaves percent blank.
    manualPercentInput: progress?.percent?.toString() ?? null,
  };
}

export type ProgressDraftFields = ReturnType<typeof progressToDraft>;
export type MetricField = Exclude<keyof ProgressDraftFields, "manualPercentInput">;

export const metricRows = [
  [
    { field: "currentPageInput", label: "Pages read", placeholder: "Current" },
    { field: "totalPagesInput", label: "Total pages", placeholder: "Total" },
  ],
  [
    { field: "currentChapterInput", label: "Chapters read", placeholder: "Current" },
    { field: "totalChaptersInput", label: "Total chapters", placeholder: "Total" },
  ],
] as const satisfies readonly (readonly {
  field: MetricField;
  label: string;
  placeholder: string;
}[])[];

function parseNumberInput(value: string) {
  const parsed = Number(value.trim() === "" ? undefined : value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function progressDraftValues(fields: ProgressDraftFields) {
  const values = {
    currentPage: parseNumberInput(fields.currentPageInput),
    totalPages: parseNumberInput(fields.totalPagesInput),
    currentChapter: parseNumberInput(fields.currentChapterInput),
    totalChapters: parseNumberInput(fields.totalChaptersInput),
  };
  const autoPercent = calculatePercentFromProgressValues(values);
  return {
    values,
    autoPercent,
    percentInput: fields.manualPercentInput ?? (autoPercent !== null ? String(autoPercent) : ""),
  };
}

export function progressDraftPayload(
  fields: ProgressDraftFields,
  updatedAt: string,
): { ok: true; progress: BookProgress } | { ok: false; error: string } {
  for (const row of metricRows) {
    for (const { field, label } of row) {
      const value = fields[field];
      if (value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 1)) {
        return { ok: false, error: `${label} must be a positive whole number.` };
      }
    }
  }
  const { values, percentInput } = progressDraftValues(fields);
  if (
    percentInput.trim() &&
    (!Number.isFinite(Number(percentInput)) ||
      Number(percentInput) < 0 ||
      Number(percentInput) > 100)
  ) {
    return { ok: false, error: "Percent must be between 0 and 100." };
  }

  const progress: BookProgress = { updatedAt };
  if (percentInput.trim()) {
    progress.percent = Math.min(100, Math.max(0, Math.round(Number(percentInput))));
  }
  for (const key of ["currentPage", "totalPages", "currentChapter", "totalChapters"] as const) {
    if (typeof values[key] === "number") progress[key] = values[key];
  }
  return Object.keys(progress).length === 1
    ? { ok: false, error: "Enter at least one progress metric before saving." }
    : { ok: true, progress };
}
