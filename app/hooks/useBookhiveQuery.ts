import { authFetch } from "@/context/auth";
import { useQuery } from "@tanstack/react-query";
import { HiveBook } from "../../src/types";
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
