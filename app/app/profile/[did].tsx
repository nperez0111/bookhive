import { useLocalSearchParams } from "expo-router";
import ReaderProfileScreen from "@/components/profile/ReaderProfileScreen";
import { BackNavigationHeader } from "@/components/BackNavigationHeader";
import { ThemedView } from "@/components/ThemedView";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";

export default function ProfileScreen() {
  const { did } = useLocalSearchParams<{ did: string }>();
  const top = useScreenTopInset();
  return (
    <ThemedView style={{ flex: 1, paddingTop: top }}>
      <BackNavigationHeader title="Reader profile" />
      <ReaderProfileScreen key={did} did={did} />
    </ThemedView>
  );
}
