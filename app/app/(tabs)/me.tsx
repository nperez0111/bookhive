import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";
import ReaderProfileScreen from "@/components/profile/ReaderProfileScreen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HeaderAction } from "@/components/HeaderAction";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/context/auth";
import { useColorScheme } from "@/hooks/useColorScheme";

export default function MyProfileScreen() {
  const { authState } = useAuth();
  const top = useScreenTopInset();
  const colors = Colors[useColorScheme() ?? "light"];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: top }}>
        <ScreenHeader
          title="Profile"
          actions={
            <HeaderAction
              tone="neutral"
              accessibilityLabel="Settings"
              onPress={() => router.push("/settings")}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="settings-outline" size={24} color={colors.primaryText} />
            </HeaderAction>
          }
        />
      </View>
      {authState?.did && <ReaderProfileScreen did={authState.did} inProfileTab />}
    </View>
  );
}
