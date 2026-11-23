import { useFonts, type FontFamilyDefinition } from "expo-font";
import { createContext, useContext, useEffect, type ReactNode } from "react";

const alloFamily = "BookHiveAllo";
const fonts: FontFamilyDefinition[] = [
  {
    fontFamily: alloFamily,
    fontDefinitions: [
      { path: require("../assets/fonts/Allo-Regular.otf"), weight: 400 },
      { path: require("../assets/fonts/Allo-Medium.otf"), weight: 500 },
      { path: require("../assets/fonts/Allo-SemiBold.otf"), weight: 600 },
      { path: require("../assets/fonts/Allo-Bold.otf"), weight: 700 },
      { path: require("../assets/fonts/Allo-ExtraBold.otf"), weight: 800 },
      { path: require("../assets/fonts/Allo-Oblique.otf"), weight: 400, style: "italic" },
      { path: require("../assets/fonts/Allo-BoldOblique.otf"), weight: 700, style: "italic" },
    ],
  },
];

const SansFontContext = createContext<string | undefined>(undefined);

export function TypographyProvider({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts(fonts);

  useEffect(() => {
    if (error) console.warn("Allo could not load; using system typography:", error);
  }, [error]);

  return (
    <SansFontContext.Provider value={loaded ? alloFamily : undefined}>
      {children}
    </SansFontContext.Provider>
  );
}

export function useSansFont() {
  return useContext(SansFontContext);
}
