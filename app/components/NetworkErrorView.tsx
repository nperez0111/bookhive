import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { ThemedText } from "./ThemedText";
import { ThemedView } from "./ThemedView";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "@/hooks/useThemeColor";

export interface NetworkError {
  type:
    | "network"
    | "server"
    | "timeout"
    | "unauthorized"
    | "not_found"
    | "unknown";
  message: string;
  retryable: boolean;
  statusCode?: number;
}

interface NetworkErrorViewProps {
  error: NetworkError;
  onRetry?: () => void;
  onGoBack?: () => void;
  showRetryButton?: boolean;
  showGoBackButton?: boolean;
}

export const NetworkErrorView: React.FC<NetworkErrorViewProps> = ({
  error,
  onRetry,
  onGoBack,
  showRetryButton = true,
  showGoBackButton = true,
}) => {
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  const getErrorIcon = () => {
    switch (error.type) {
      case "network":
        return "wifi-outline";
      case "server":
        return "server-outline";
      case "timeout":
        return "time-outline";
      case "unauthorized":
        return "lock-closed-outline";
      case "not_found":
        return "search-outline";
      default:
        return "warning-outline";
    }
  };

  const getErrorTitle = () => {
    switch (error.type) {
      case "network":
        return "No Internet Connection";
      case "server":
        return "Server Error";
      case "timeout":
        return "Request Timeout";
      case "unauthorized":
        return "Authentication Required";
      case "not_found":
        return "Not Found";
      default:
        return "Something went wrong";
    }
  };

  const getErrorMessage = () => {
    if (error.message) return error.message;

    switch (error.type) {
      case "network":
        return "Please check your internet connection and try again.";
      case "server":
        return "Our servers are experiencing issues. Please try again later.";
      case "timeout":
        return "The request took too long to complete. Please try again.";
      case "unauthorized":
        return "Please sign in again to continue.";
      case "not_found":
        return "The requested resource was not found.";
      default:
        return "An unexpected error occurred. Please try again.";
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor }]}>
      <View style={styles.content}>
        <Ionicons name={getErrorIcon()} size={64} color="#FBBF24" />

        <ThemedText style={[styles.title, { color: textColor }]}>
          {getErrorTitle()}
        </ThemedText>

        <ThemedText style={[styles.message, { color: textColor }]}>
          {getErrorMessage()}
        </ThemedText>

        {error.statusCode && (
          <ThemedText style={[styles.statusCode, { color: textColor }]}>
            Error {error.statusCode}
          </ThemedText>
        )}

        <View style={styles.buttonContainer}>
          {showRetryButton && error.retryable && onRetry && (
            <Pressable style={styles.retryButton} onPress={onRetry}>
              <Ionicons name="refresh" size={20} color="white" />
              <ThemedText style={styles.retryButtonText}>Try Again</ThemedText>
            </Pressable>
          )}

          {showGoBackButton && onGoBack && (
            <Pressable
              style={[styles.goBackButton, { borderColor: textColor }]}
              onPress={onGoBack}
            >
              <Ionicons name="arrow-back" size={20} color={textColor} />
              <ThemedText
                style={[styles.goBackButtonText, { color: textColor }]}
              >
                Go Back
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  content: {
    alignItems: "center",
    maxWidth: 300,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  message: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 24,
  },
  statusCode: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 24,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FBBF24",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    gap: 8,
  },
  retryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  goBackButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    gap: 8,
  },
  goBackButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
