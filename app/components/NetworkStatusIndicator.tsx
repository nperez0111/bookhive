import React from "react";
import { View, StyleSheet, Animated } from "react-native";
import { ThemedText } from "./ThemedText";
import { Ionicons } from "@expo/vector-icons";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useEffect, useRef } from "react";

interface NetworkStatusIndicatorProps {
  showAlways?: boolean;
  position?: "top" | "bottom";
}

export const NetworkStatusIndicator: React.FC<NetworkStatusIndicatorProps> = ({
  showAlways = false,
  position = "top",
}) => {
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const slideAnim = useRef(new Animated.Value(-50)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const isOnline = isConnected && isInternetReachable !== false;

  useEffect(() => {
    if (!isOnline) {
      // Slide in when offline
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!showAlways) {
      // Slide out when online (unless showAlways is true)
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -50,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOnline, showAlways, slideAnim, opacityAnim]);

  if (isOnline && !showAlways) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: isOnline ? "#10B981" : "#EF4444",
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
          [position]: 0,
        },
      ]}
    >
      <View style={styles.content}>
        <Ionicons
          name={isOnline ? "wifi" : "wifi-outline"}
          size={16}
          color="white"
        />
        <ThemedText style={styles.text}>
          {isOnline ? "Connected" : "No Internet Connection"}
        </ThemedText>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  text: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
});
