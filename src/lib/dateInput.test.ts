import { describe, it, expect } from "bun:test";
import { dateInputToISO, toDateInputValue } from "./dateInput";

describe("dateInputToISO", () => {
  // Noon, not midnight: a midnight-UTC stamp displays as the *previous* day
  // anywhere west of Greenwich, so the date a user typed came back different.
  it("anchors a bare date at noon UTC", () => {
    expect(dateInputToISO("2025-03-14")).toBe("2025-03-14T12:00:00.000Z");
  });

  it("passes a full datetime through", () => {
    expect(dateInputToISO("2025-03-14T08:30:00.000Z")).toBe("2025-03-14T08:30:00.000Z");
  });

  it("is empty for empty input", () => {
    expect(dateInputToISO("")).toBe("");
  });

  // Date.UTC rolls this to March 3. Returning the raw value lets the caller's
  // `datetime()` check reject it instead of silently storing the wrong day.
  it("returns an impossible date unchanged", () => {
    expect(dateInputToISO("2025-02-31")).toBe("2025-02-31");
  });
});

describe("toDateInputValue", () => {
  it("renders the calendar date", () => {
    expect(toDateInputValue("2025-03-14T12:00:00.000Z")).toBe("2025-03-14");
  });

  it("is empty for null, undefined and unparseable input", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(undefined)).toBe("");
    expect(toDateInputValue("not a date")).toBe("");
  });

  it("round-trips a bare date", () => {
    expect(toDateInputValue(dateInputToISO("2025-03-14"))).toBe("2025-03-14");
  });
});
