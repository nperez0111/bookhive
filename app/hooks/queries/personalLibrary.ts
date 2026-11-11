import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { authSession, createSessionFetch } from "@/context/auth";
import type {
  PersonalBook,
  PersonalShelf,
  PersonalStorage,
  PersonalLibraryPage,
} from "@/api/personalLibraryTypes";
import { UploadError, uploadBookFile } from "@/api/uploadPersonalBook";
import { personalLibraryQuery, type PersonalLibraryFilters } from "@/utils/personalLibraryQuery";
import { beginLibraryMutation, useInvalidateLibrary } from "./personalLibraryCache";
import { bookMutationQueue } from "@/utils/bookMutations";

export const usePersonalLibrary = (filters?: number | PersonalLibraryFilters) => {
  const request = createSessionFetch();
  const options = typeof filters === "number" ? { shelfId: filters } : filters;
  return useInfiniteQuery({
    queryKey: personalLibraryQuery(options).queryKey,
    initialPageParam: "",
    queryFn: async ({ queryKey: [, shelfId, q, sort], pageParam }) => {
      const { url } = personalLibraryQuery({ shelfId: shelfId ?? undefined, q, sort }, pageParam);
      return await request<PersonalLibraryPage>(url);
    },
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

/** Every page has fresh usage. Prefer the last page, then the first for older responses. */
export function storageFromLibrary(
  data: { pages: { storage?: PersonalStorage }[] } | undefined,
): PersonalStorage | null {
  if (!data?.pages.length) return null;
  return data.pages[data.pages.length - 1]?.storage ?? data.pages[0]?.storage ?? null;
}

export const usePersonalShelves = () => {
  const request = createSessionFetch();
  return useQuery({
    queryKey: ["personalShelves"] as const,
    queryFn: async () => {
      const result = await request<{ shelves: PersonalShelf[] }>(`/library/shelves`);
      return result?.shelves ?? [];
    },
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

export const useUploadPersonalBook = () => {
  const session = authSession.capture();
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: (input: Parameters<typeof uploadBookFile>[0]) => uploadBookFile(input, session),
    onSuccess: () => {
      if (session.signal.aborted) return;
      // Upload may adopt a synced document, moving it from triage into the grid.
      invalidateLibrary();
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error) => {
      if (session.signal.aborted) return;
      if (
        error instanceof UploadError &&
        (error.code === "QuotaExceeded" ||
          error.code === "AlreadyExists" ||
          // A malformed 2xx may still have committed the upload.
          (error.status >= 200 && error.status < 300))
      ) {
        void queryClient.invalidateQueries({ queryKey: ["personalLibrary"] });
      }
    },
    retry: false,
  });
};

export const useDeletePersonalBook = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ contentHash }: { contentHash: string }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.deletePersonalBook`, {
        method: "POST",
        body: { contentHash },
      });
    },
    onMutate: async ({ contentHash }) => {
      session.assertCurrent();
      const finish = beginLibraryMutation(queryClient, `file:${contentHash}`);
      try {
        await queryClient.cancelQueries({ queryKey: ["personalLibrary"] });
        session.assertCurrent();
        const previous = queryClient.getQueriesData<InfiniteData<PersonalLibraryPage>>({
          queryKey: ["personalLibrary"],
        });
        queryClient.setQueriesData<InfiniteData<PersonalLibraryPage>>(
          { queryKey: ["personalLibrary"] },
          (old) => {
            if (!old?.pages) return old;
            if (
              !old.pages.some((page) => page.books.some((book) => book.contentHash === contentHash))
            ) {
              return old;
            }
            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                books: page.books.filter((b) => b.contentHash !== contentHash),
                ...(page.total !== undefined && { total: Math.max(0, page.total - 1) }),
              })),
            };
          },
        );
        return { previous, finish };
      } catch (error) {
        finish();
        throw error;
      }
    },
    onError: (_err, { contentHash }, context) => {
      if (session.signal.aborted) return;
      for (const [key, previous] of context?.previous ?? []) {
        queryClient.setQueryData<InfiniteData<PersonalLibraryPage>>(key, (current) => {
          if (!current || !previous) return current;
          if (
            current.pages.some((page) =>
              page.books.some((book) => book.contentHash === contentHash),
            )
          )
            return current;
          const sourcePage = previous.pages.findIndex((page) =>
            page.books.some((book) => book.contentHash === contentHash),
          );
          if (sourcePage < 0 || !current.pages[sourcePage]) return current;
          const source = previous.pages[sourcePage]!;
          const index = source.books.findIndex((book) => book.contentHash === contentHash);
          return {
            ...current,
            pages: current.pages.map((page, pageIndex) => {
              const books = [...page.books];
              if (pageIndex === sourcePage) {
                const next = source.books
                  .slice(index + 1)
                  .find((book) =>
                    books.some((currentBook) => currentBook.contentHash === book.contentHash),
                  );
                const position = next
                  ? books.findIndex((book) => book.contentHash === next.contentHash)
                  : books.length;
                books.splice(position, 0, source.books[index]!);
              }
              return { ...page, books, ...(page.total !== undefined && { total: page.total + 1 }) };
            }),
          };
        });
      }
    },
    onSettled: (_data, _error, _variables, context) => {
      invalidateLibrary();
      context?.finish();
    },
    retry: false,
  });
};

export const useLinkPersonalBook = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const invalidateLibrary = useInvalidateLibrary();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contentHash, hiveId }: { contentHash: string; hiveId: string }) => {
      return await request<{ book: PersonalBook }>(`/xrpc/buzz.bookhive.linkPersonalBook`, {
        method: "POST",
        body: { contentHash, hiveId },
      });
    },
    onSuccess: (_data, { hiveId }) => {
      if (session.signal.aborted) return;
      invalidateLibrary();
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      bookMutationQueue(queryClient, () => !session.signal.aborted).refresh(hiveId);
    },
    retry: false,
  });
};

export const useUnlinkPersonalBook = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ contentHash }: { contentHash: string }) => {
      return await request<{ book: PersonalBook }>(`/xrpc/buzz.bookhive.unlinkPersonalBook`, {
        method: "POST",
        body: { contentHash },
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useCreatePersonalShelf = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      return await request<{ shelf: PersonalShelf }>(`/xrpc/buzz.bookhive.createPersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    },
    retry: false,
  });
};

export const useUpdatePersonalShelf = () => {
  const request = createSessionFetch();
  const session = authSession.capture();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; name?: string; description?: string }) => {
      return await request<{ shelf: PersonalShelf }>(`/xrpc/buzz.bookhive.updatePersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: () => {
      if (session.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: ["personalShelves"] });
    },
    retry: false,
  });
};

export const useDeletePersonalShelf = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.deletePersonalShelf`, {
        method: "POST",
        body: { id },
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useAddToPersonalShelf = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { shelfId: number; contentHash: string }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.addToPersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};

export const useRemoveFromPersonalShelf = () => {
  const request = createSessionFetch();
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { shelfId: number; contentHash: string }) => {
      return await request<Record<string, never>>(`/xrpc/buzz.bookhive.removeFromPersonalShelf`, {
        method: "POST",
        body: input,
      });
    },
    onSuccess: invalidateLibrary,
    retry: false,
  });
};
