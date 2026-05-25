import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

const LANGUAGE_STORAGE_KEY = "preferred_language";

interface LanguageContextType {
  /** Current preferred language, or null for "All Languages" */
  preferredLanguage: string | null;
  /** Set the preferred language (null to clear) */
  setPreferredLanguage: (language: string | null) => void;
  /** Whether the preference has been loaded from AsyncStorage */
  isLoaded: boolean;
}

const LanguageContext = createContext<LanguageContextType>({
  preferredLanguage: null,
  setPreferredLanguage: () => {},
  isLoaded: false,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [preferredLanguage, setPreferredLanguageState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved language preference
  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((saved) => {
        if (saved) {
          setPreferredLanguageState(saved);
        }
        setIsLoaded(true);
      })
      .catch(() => {
        setIsLoaded(true);
      });
  }, []);

  const setPreferredLanguage = useCallback(async (language: string | null) => {
    setPreferredLanguageState(language);
    try {
      if (language) {
        await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      } else {
        await AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Failed to save language preference:", error);
    }
  }, []);

  return (
    <LanguageContext.Provider value={{ preferredLanguage, setPreferredLanguage, isLoaded }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
