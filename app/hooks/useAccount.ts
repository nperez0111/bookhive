import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authSession, createSessionFetch, useAuth } from "@/context/auth";
import type { $output as ResyncAccountOutput } from "../../src/bsky/lexicon/generated/types/buzz/bookhive/resyncAccount";
import type { $output as DeleteAccountOutput } from "../../src/bsky/lexicon/generated/types/buzz/bookhive/deleteAccount";

export function useResyncBooks() {
  const client = useQueryClient();
  const sessionFetch = createSessionFetch();
  const scope = authSession.capture();
  return useMutation({
    mutationFn: async () => {
      const result = await sessionFetch<ResyncAccountOutput>("/xrpc/buzz.bookhive.resyncAccount", {
        method: "POST",
        body: {},
        retry: 0,
        timeout: 5 * 60 * 1000,
      });
      if (result.success !== true) throw new Error("Could not re-sync your books.");
      return { ...result, scope };
    },
    retry: false,
    onSuccess: ({ scope: requestScope }) => {
      if (!requestScope.signal.aborted) return client.invalidateQueries();
    },
  });
}

export function useDeleteAccount() {
  const { signOut } = useAuth();
  const sessionFetch = createSessionFetch();
  const scope = authSession.capture();
  return useMutation({
    mutationFn: async (confirmHandle: string) => {
      const result = await sessionFetch<DeleteAccountOutput>("/xrpc/buzz.bookhive.deleteAccount", {
        method: "POST",
        body: { confirmHandle },
        retry: 0,
        timeout: 5 * 60 * 1000,
      });
      if (result.success !== true) throw new Error("Could not delete your data.");
      return { ...result, scope };
    },
    retry: false,
    onSuccess: async ({ scope: requestScope }) => {
      if (requestScope.signal.aborted) return;
      // signOut replaces the session synchronously; root SessionCache owns teardown.
      await signOut();
    },
  });
}
