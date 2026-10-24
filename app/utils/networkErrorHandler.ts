import type { NetworkError } from "@/components/NetworkErrorView";
import { isCancelledError } from "@tanstack/react-query";

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
  name?: string;
}

export const classifyNetworkError = (error: any): NetworkError => {
  const message = typeof error?.message === "string" ? error.message : "";
  const status = error?.status ?? error?.response?.status;
  // Handle fetch errors
  if (error?.name === "TypeError" && message.includes("fetch")) {
    return {
      type: "network",
      message: "Unable to connect to the server. Please check your internet connection.",
      retryable: true,
    };
  }

  // Handle timeout errors
  if (
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    error?.cause?.name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return {
      type: "timeout",
      message: "The request timed out. Please try again.",
      retryable: true,
    };
  }

  // Handle HTTP status codes
  if (status) {
    switch (status) {
      case 401:
        return {
          type: "unauthorized",
          message: "Your session has expired. Please sign in again.",
          retryable: false,
          statusCode: 401,
        };
      case 403:
        return {
          type: "unauthorized",
          message: "You do not have permission to access this resource.",
          retryable: false,
          statusCode: 403,
        };
      case 404:
        return {
          type: "not_found",
          message: "The requested resource was not found.",
          retryable: false,
          statusCode: 404,
        };
      case 408:
        return {
          type: "timeout",
          message: "The request timed out. Please try again.",
          retryable: true,
          statusCode: 408,
        };
      case 429:
        return {
          type: "server",
          message: "Too many requests. Please wait a moment and try again.",
          retryable: true,
          statusCode: 429,
        };
      case 500:
        return {
          type: "server",
          message: "Internal server error. Please try again later.",
          retryable: true,
          statusCode: 500,
        };
      case 502:
      case 503:
      case 504:
        return {
          type: "server",
          message: "Service temporarily unavailable. Please try again later.",
          retryable: true,
          statusCode: status,
        };
      default:
        return {
          type: "server",
          message: `Server error (${status}). Please try again.`,
          retryable: status >= 500,
          statusCode: status,
        };
    }
  }

  // Handle network connectivity issues
  if (
    message.includes("Network request failed") ||
    message.includes("Network Error") ||
    message.includes("ERR_NETWORK")
  ) {
    return {
      type: "network",
      message: "No internet connection. Please check your network settings.",
      retryable: true,
    };
  }

  // Handle DNS resolution errors
  if (message.includes("ENOTFOUND") || message.includes("DNS")) {
    return {
      type: "network",
      message: "Unable to reach the server. Please check your internet connection.",
      retryable: true,
    };
  }

  // Handle SSL/TLS errors
  if (message.includes("SSL") || message.includes("TLS")) {
    return {
      type: "network",
      message: "Secure connection failed. Please try again.",
      retryable: true,
    };
  }

  // Default unknown error
  return {
    type: "unknown",
    message: message || "An unexpected error occurred. Please try again.",
    retryable: true,
  };
};

/** Queries may throw raw ofetch errors or the catalogue's enhanced errors. */
export const shouldRetryQuery = (failureCount: number, error: any): boolean => {
  const original = error?.originalError ?? error;
  if (
    isCancelledError(original) ||
    original?.name === "AbortError" ||
    original?.cause?.name === "AbortError" ||
    original?.message?.includes("Authentication session changed")
  ) {
    return false;
  }
  return failureCount < 3 && (error?.networkError ?? classifyNetworkError(original)).retryable;
};

export const isRetryableError = (error: NetworkError): boolean => {
  return error.retryable;
};

export const getRetryDelay = (attempt: number): number => {
  // Exponential backoff with jitter
  const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000);
  const jitter = Math.random() * 0.1 * baseDelay;
  return baseDelay + jitter;
};

export const shouldRetry = (
  error: NetworkError,
  attempt: number,
  maxAttempts: number = 3,
): boolean => {
  if (!isRetryableError(error)) return false;
  if (attempt >= maxAttempts) return false;

  // Don't retry authentication errors
  if (error.type === "unauthorized") return false;

  return true;
};
