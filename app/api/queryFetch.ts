import { authFetch } from "@/context/auth";
import { classifyNetworkError } from "@/utils/networkErrorHandler";

/** Read-query error decoration only. Mutation requests capture their own session. */
export async function enhancedAuthFetch<T>(
  url: string,
  options?: Parameters<typeof authFetch>[1],
): Promise<T> {
  try {
    return await authFetch<T>(url, options);
  } catch (error) {
    const networkError = classifyNetworkError(error);
    throw Object.assign(new Error(networkError.message), { networkError, originalError: error });
  }
}
