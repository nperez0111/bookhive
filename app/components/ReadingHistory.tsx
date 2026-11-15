import type { PreviousRead } from "../../src/bsky/lexicon/generated/types/buzz/bookhive/defs";
import type { $output } from "../../src/bsky/lexicon/generated/types/buzz/bookhive/getBook";
import { format, isValid } from "date-fns";
import React from "react";
import { View } from "react-native";
import { calendarDate } from "@/utils/calendarDate";
import { ThemedText } from "./ThemedText";

function readDate(value: string) {
  const date = calendarDate(value);
  return isValid(date) ? format(date, "MMM d, yyyy") : "Unknown date";
}

/** getBook supplies prior completed reads, newest first; these aren't progress entries. */
export function ReadingHistory({
  previousReads,
  progressHistory,
}: {
  previousReads?: PreviousRead[];
  progressHistory?: $output["progressHistory"];
}) {
  if (!previousReads?.length && !progressHistory?.length) return null;
  return (
    <View style={{ gap: 12, marginBottom: 24 }}>
      <ThemedText accessibilityRole="header" type="heading">
        Reading history
      </ThemedText>
      {previousReads?.map((read, index) => {
        const summary = `${read.startedAt ? `Started ${readDate(read.startedAt)}. ` : ""}Finished ${readDate(read.finishedAt)}.`;
        return (
          <View
            key={`${read.finishedAt}-${index}`}
            accessible
            accessibilityLabel={`Previous read ${index + 1}. ${summary}`}
          >
            <ThemedText type="label">Previous read {index + 1}</ThemedText>
            <ThemedText type="body">{summary}</ThemedText>
          </View>
        );
      })}
      {!!progressHistory?.length && (
        <>
          <ThemedText accessibilityRole="header" type="label">
            Recent progress
          </ThemedText>
          {progressHistory.map((entry, index) => {
            const metrics = [
              entry.currentPage !== undefined
                ? `${entry.currentPage}${entry.totalPages !== undefined ? ` of ${entry.totalPages}` : ""} pages`
                : entry.totalPages !== undefined
                  ? `${entry.totalPages} total pages`
                  : null,
              entry.percent !== undefined ? `${entry.percent}%` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const summary = `${readDate(entry.createdAt)}: ${metrics || "Progress recorded"}`;
            return (
              <ThemedText
                key={`${entry.createdAt}-${index}`}
                accessible
                accessibilityLabel={summary}
              >
                {summary}
              </ThemedText>
            );
          })}
        </>
      )}
    </View>
  );
}
