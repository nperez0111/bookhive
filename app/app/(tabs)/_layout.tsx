import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/HapticTab";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { AnimatedTabIcon } from "@/components/AnimatedTabIcon";
import TabBarBackground from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useAuth } from "@/context/auth";

// TODO consider using a drawer for navigation instead of tabs
// Then we can use tabs for bookshelf, search, etc.
export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { isAuthenticated } = useAuth();
  const { bottom } = useSafeAreaInsets();

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
        tabBarInactiveTintColor: Colors[colorScheme ?? "light"].icon,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
        // Remove active background to avoid label overlap/bleed
        tabBarActiveBackgroundColor: "transparent",
        tabBarItemStyle: {
          paddingVertical: 6,
          borderRadius: 12,
        },
        tabBarStyle: Platform.select({
          ios: {
            // Use a transparent background on iOS to show the blur effect
            position: "absolute",
            paddingBottom: bottom,
            height: 56 + bottom,
          },
          default: {
            borderTopWidth: 0,
            paddingBottom: bottom,
            height: 56 + bottom,
          },
        }),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name="house.fill"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name="magnifyingglass"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon name="gear" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="book/[id]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile/[did]"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
