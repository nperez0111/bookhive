/**
 * Parse an ISO datetime or YYYY-MM-DD string into a Date representing local
 * noon on that calendar date, so timezone offsets never shift the day.
 */
export function calendarDate(dateStr: string): Date {
  const ymd = dateStr.includes("T") ? dateStr.split("T")[0]! : dateStr;
  return new Date(ymd + "T12:00:00");
}
