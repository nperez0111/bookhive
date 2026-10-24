export type PersonalLibrarySort = "recent" | "title" | "author";

export type PersonalLibraryFilters = {
  shelfId?: number;
  q?: string;
  sort?: PersonalLibrarySort;
};

export function personalLibraryQuery(filters: PersonalLibraryFilters = {}, cursor = "") {
  const shelfId = filters.shelfId ?? null;
  const q = (filters.q ?? "").trim().slice(0, 256);
  const sort = filters.sort ?? "recent";
  const params = new URLSearchParams({ limit: "24", sort });
  if (shelfId !== null) params.set("shelfId", String(shelfId));
  if (q) params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  return {
    queryKey: ["personalLibrary", shelfId, q, sort] as const,
    url: `/xrpc/buzz.bookhive.getPersonalLibrary?${params}`,
  };
}
