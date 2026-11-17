import { View } from "react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HeaderAction } from "@/components/HeaderAction";
import { TrackedBooksContent } from "@/components/tracked-books/TrackedBooksContent";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useScreenTopInset } from "@/hooks/useScreenTopInset";

export default function MyBooksScreen() {
  const router = useRouter();
  const colors = Colors[useColorScheme() ?? "light"];
  const top = useScreenTopInset();
  return (
    <View style={{ flex: 1, paddingTop: top, backgroundColor: colors.background }}>
      <ScreenHeader
        title="My Books"
        actions={<HeaderAction title="Ebooks" onPress={() => router.push("/library")} />}
      />
      <TrackedBooksContent />
    </View>
  );
}
