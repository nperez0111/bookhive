import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { ThemedView } from "./ThemedView";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "@/hooks/useThemeColor";
import { NetworkErrorView, NetworkError } from "./NetworkErrorView";
import { classifyNetworkError } from "@/utils/networkErrorHandler";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

interface QueryErrorHandlerProps {
  error: any;
  onRetry?: () => void;
  onGoBack?: () => void;
  showRetryButton?: boolean;
  showGoBackButton?: boolean;
  fallbackMessage?: string;
}

export const QueryErrorHandler: React.FC<QueryErrorHandlerProps> = ({
  error,
  onRetry,
  onGoBack,
  showRetryButton = true,
  showGoBackButton = true,
  fallbackMessage,
}) => {
  const { isConnected } = useNetworkStatus();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  // Classify the error
  const networkError: NetworkError =
    error?.networkError || classifyNetworkError(error);

  // If we're offline and it's a network error, show offline message
  if (!isConnected && networkError.type === "network") {
    return (
      <ThemedView style={[styles.container, { backgroundColor }]}>
        <View style={styles.content}>
          <Ionicons name="wifi-outline" size={64} color="#FBBF24" />
          <ThemedText style={[styles.title, { color: textColor }]}>
            You're Offline
          </ThemedText>
          <ThemedText style={[styles.message, { color: textColor }]}>
            Please check your internet connection and try again.
          </ThemedText>
          {onRetry && (
            <ThemedText style={[styles.retryHint, { color: textColor }]}>
              Pull down to refresh when you're back online.
            </ThemedText>
          )}
        </View>
      </ThemedView>
    );
  }

  // Use the NetworkErrorView for other types of errors
  return (
    <NetworkErrorView
      error={networkError}
      onRetry={onRetry}
      onGoBack={onGoBack}
      showRetryButton={showRetryButton}
      showGoBackButton={showGoBackButton}
    />
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
  retryHint: {
    fontSize: 14,
    textAlign: "center",
    opacity: 0.7,
    fontStyle: "italic",
  },
});
