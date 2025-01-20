import { authFetch } from "@/context/auth";
import { useQuery } from "@tanstack/react-query";
import { HiveBook, HiveId, GetBook, GetProfile } from "../../src/types";
import { useEffect, useState } from "react";

const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

export const useSearchBooks = (query: string) => {
  const debouncedQuery = useDebounce(query, 300);

  return useQuery({
    queryKey: ["searchBooks", query] as const,
    queryFn: async ({ queryKey: [, q] }) => {
      return await authFetch<HiveBook[]>(
        `/xrpc/buzz.bookhive.searchBooks?q=${q}`,
      );
    },
    enabled: Boolean(debouncedQuery),
  });
};

/**
 * Get a book by its ID
 * @param id If undefined, the query will not be enabled
 * @returns
 */
export const useBookInfo = (id: HiveId | undefined | null) => {
  return useQuery({
    queryKey: ["getBook", id] as const,
    queryFn: async ({ queryKey: [, hiveId] }) => {
      return await authFetch<GetBook.OutputSchema>(
        `/xrpc/buzz.bookhive.getBook?id=${hiveId}`,
      );
    },
    enabled: Boolean(id),
  });
};

/**
 * Get a user's profile by their DID or handle
 * @param didOrHandle If undefined, the auth'd user's profile will be fetched
 * @returns
 */
export const useProfile = (didOrHandle?: string) => {
  return useQuery({
    queryKey: ["profile", didOrHandle] as const,
    queryFn: async ({ queryKey: [, id] }) => {
      return await authFetch<GetProfile.OutputSchema>(
        `/xrpc/buzz.bookhive.getProfile?id=${id}`,
      );
    },
  });
};
