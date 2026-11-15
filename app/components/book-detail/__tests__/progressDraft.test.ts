import { progressDraftPayload, progressDraftValues, progressToDraft } from "../progressDraft";

const now = "2026-10-24T00:00:00Z";

it("keeps precise page counts when the displayed percentage rounds to completion", () => {
  expect(
    progressDraftPayload(
      { ...progressToDraft(undefined), currentPageInput: "657", totalPagesInput: "658" },
      now,
    ),
  ).toEqual({
    ok: true,
    progress: { updatedAt: now, currentPage: 657, totalPages: 658, percent: 100 },
  });
});

it("distinguishes automatic percentage, manual zero and an intentionally blank percent", () => {
  const fields = { ...progressToDraft(undefined), currentPageInput: "20", totalPagesInput: "100" };
  expect(progressDraftValues(fields).percentInput).toBe("20");
  expect(progressDraftPayload({ ...fields, manualPercentInput: "0" }, now)).toEqual({
    ok: true,
    progress: { updatedAt: now, currentPage: 20, totalPages: 100, percent: 0 },
  });
  expect(progressDraftPayload({ ...fields, manualPercentInput: "" }, now)).toEqual({
    ok: true,
    progress: { updatedAt: now, currentPage: 20, totalPages: 100 },
  });
});

it("refuses timestamp-only writes", () => {
  expect(progressDraftPayload(progressToDraft(undefined), now)).toEqual({
    ok: false,
    error: "Enter at least one progress metric before saving.",
  });
});

it("treats whitespace-only metrics as absent instead of sending zero", () => {
  expect(
    progressDraftPayload({ ...progressToDraft(undefined), currentPageInput: "  " }, now),
  ).toEqual({
    ok: false,
    error: "Enter at least one progress metric before saving.",
  });
  expect(
    progressDraftPayload(
      {
        ...progressToDraft(undefined),
        currentPageInput: "  ",
        totalPagesInput: "100",
        manualPercentInput: " ",
      },
      now,
    ),
  ).toEqual({ ok: true, progress: { updatedAt: now, totalPages: 100 } });
});

it.each(["-1", "0", "1.5", "NaN", "Infinity"])(
  "rejects invalid page input %s without dropping it",
  (value) => {
    expect(
      progressDraftPayload({ ...progressToDraft(undefined), currentPageInput: value }, now),
    ).toEqual({ ok: false, error: "Pages read must be a positive whole number." });
  },
);

it.each(["-1", "101", "NaN"])("rejects invalid manual percentage %s", (value) => {
  expect(
    progressDraftPayload({ ...progressToDraft(undefined), manualPercentInput: value }, now),
  ).toEqual({ ok: false, error: "Percent must be between 0 and 100." });
});
