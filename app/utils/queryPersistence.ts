import { defaultShouldDehydrateQuery, type Query } from "@tanstack/react-query";

/** Credentials stay in memory, even inside a viewer-partitioned disk cache. */
export function shouldPersistQuery(query: Query) {
  return (
    query.queryKey[0] !== "syncPassword" &&
    query.meta?.persist !== false &&
    defaultShouldDehydrateQuery(query)
  );
}
