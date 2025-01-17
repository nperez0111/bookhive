import { Image, StyleSheet, Platform, Button } from "react-native";

import { HelloWave } from "@/components/HelloWave";
import ParallaxScrollView from "@/components/ParallaxScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useAuth } from "@/context/auth";
import { useState } from "react";

export default function HomeScreen() {
  const { signOut, authState } = useAuth();
  const [books, setBooks] = useState<
    {
      id: string;
      title: string;
      authors: string;
      cover: string | null;
      thumbnail: string;
    }[]
  >([]);
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: "#A1CEDC", dark: "#1D3D47" }}
      headerImage={
        <Image
          source={require("@/assets/images/partial-react-logo.png")}
          style={styles.reactLogo}
        />
      }
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Welcome!</ThemedText>
        <HelloWave />
      </ThemedView>
      <Button title="Sign Out" onPress={signOut} />
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Step 1: Try it</ThemedText>
        <Button
          title="Make Request"
          onPress={async () => {
            try {
              const response = await fetch(
                "http://localhost:8080/xrpc/buzz.bookhive.searchBooks?q=it+works",
                {
                  headers: {
                    cookie: `sid=${authState?.sid}`,
                  },
                },
              ).then((res) => {
                if (!res.ok) {
                  throw new Error("Failed to fetch");
                }
                return res.json();
              });
              setBooks(response);
              console.log(response);
            } catch (e) {
              console.error(e);
            }
          }}
        />
        <ThemedText>
          Edit{" "}
          <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText>{" "}
          to see changes. Press{" "}
          <ThemedText type="defaultSemiBold">
            {Platform.select({
              ios: "cmd + d",
              android: "cmd + m",
              web: "F12",
            })}
          </ThemedText>{" "}
          to open developer tools.
        </ThemedText>
      </ThemedView>
      {books.map((book) => (
        <ThemedView key={book.id}>
          <Image
            source={{
              uri: `http://localhost:8080/images/s_300x500,fit_cover,extend_5_5_5_5,b_030712/${book.cover || book.thumbnail}`,
            }}
            style={styles.cover}
          />
          <ThemedText type="subtitle">{book.title}</ThemedText>
          <ThemedText>{book.authors}</ThemedText>
        </ThemedView>
      ))}
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: "absolute",
  },
  cover: {
    width: 150,
    height: 250,
  },
});
