import { describe, it, expect } from "vitest";
import {
  buildAuthorLikePatterns,
  parseAuthors,
  formatAuthors,
  calculatePagination,
} from "./authorMatching";

describe("authorMatching utilities", () => {
  describe("buildAuthorLikePatterns", () => {
    it("should build correct patterns for a simple author name", () => {
      const patterns = buildAuthorLikePatterns("Brandon Sanderson");

      expect(patterns.exact).toBe("Brandon Sanderson");
      expect(patterns.first).toBe("Brandon Sanderson\t%");
      expect(patterns.middle).toBe("%\tBrandon Sanderson\t%");
      expect(patterns.last).toBe("%\tBrandon Sanderson");
    });

    it("should handle author names with special characters", () => {
      const patterns = buildAuthorLikePatterns("J.R.R. Tolkien");

      expect(patterns.exact).toBe("J.R.R. Tolkien");
      expect(patterns.first).toBe("J.R.R. Tolkien\t%");
      expect(patterns.middle).toBe("%\tJ.R.R. Tolkien\t%");
      expect(patterns.last).toBe("%\tJ.R.R. Tolkien");
    });

    it("should handle author names with apostrophes", () => {
      const patterns = buildAuthorLikePatterns("Tamsyn O'Flynn");

      expect(patterns.exact).toBe("Tamsyn O'Flynn");
      expect(patterns.first).toBe("Tamsyn O'Flynn\t%");
    });

    it("should handle empty string", () => {
      const patterns = buildAuthorLikePatterns("");

      expect(patterns.exact).toBe("");
      expect(patterns.first).toBe("\t%");
      expect(patterns.middle).toBe("%\t\t%");
      expect(patterns.last).toBe("%\t");
    });
  });

  describe("parseAuthors", () => {
    it("should parse single author", () => {
      expect(parseAuthors("Brandon Sanderson")).toEqual(["Brandon Sanderson"]);
    });

    it("should parse multiple authors", () => {
      expect(parseAuthors("Brandon Sanderson\tHoward Tayler\tDan Wells")).toEqual([
        "Brandon Sanderson",
        "Howard Tayler",
        "Dan Wells",
      ]);
    });

    it("should filter empty strings", () => {
      expect(parseAuthors("Brandon Sanderson\t\tHoward Tayler")).toEqual([
        "Brandon Sanderson",
        "Howard Tayler",
      ]);
    });

    it("should return empty array for empty string", () => {
      expect(parseAuthors("")).toEqual([]);
    });
  });

  describe("formatAuthors", () => {
    it("should format single author", () => {
      expect(formatAuthors(["Brandon Sanderson"])).toBe("Brandon Sanderson");
    });

    it("should format multiple authors with tab separator", () => {
      expect(formatAuthors(["Brandon Sanderson", "Howard Tayler"])).toBe(
        "Brandon Sanderson\tHoward Tayler",
      );
    });

    it("should return empty string for empty array", () => {
      expect(formatAuthors([])).toBe("");
    });
  });

  describe("calculatePagination", () => {
    it("should calculate correct values for first page", () => {
      const result = calculatePagination(250, 100, 1);

      expect(result.totalPages).toBe(3);
      expect(result.offset).toBe(0);
      expect(result.validPage).toBe(1);
    });

    it("should calculate correct offset for middle page", () => {
      const result = calculatePagination(250, 100, 2);

      expect(result.totalPages).toBe(3);
      expect(result.offset).toBe(100);
      expect(result.validPage).toBe(2);
    });

    it("should handle page size that divides evenly", () => {
      const result = calculatePagination(200, 100, 1);

      expect(result.totalPages).toBe(2);
    });

    it("should handle single item", () => {
      const result = calculatePagination(1, 100, 1);

      expect(result.totalPages).toBe(1);
      expect(result.offset).toBe(0);
    });

    it("should handle zero items", () => {
      const result = calculatePagination(0, 100, 1);

      expect(result.totalPages).toBe(0);
      expect(result.offset).toBe(0);
    });

    it("should clamp negative page to 1", () => {
      const result = calculatePagination(100, 10, -5);

      expect(result.validPage).toBe(1);
      expect(result.offset).toBe(0);
    });

    it("should clamp zero page to 1", () => {
      const result = calculatePagination(100, 10, 0);

      expect(result.validPage).toBe(1);
      expect(result.offset).toBe(0);
    });
  });
});
