import { router } from "expo-router";

/**
 * Navigate to a user's profile page
 * @param did The user's DID (Decentralized Identifier)
 */
export const navigateToProfile = (did: string) => {
  router.push(`/profile/${did}`);
};

/**
 * Navigate to a book's detail page
 * @param hiveId The book's Hive ID
 */
export const navigateToBook = (hiveId: string) => {
  router.push(`/book/${hiveId}`);
};

/**
 * Navigate to the search page
 */
export const navigateToSearch = () => {
  router.push("/search");
};

/**
 * Navigate to the home page
 */
export const navigateToHome = () => {
  router.push("/");
};

/**
 * Navigate to the settings page
 */
export const navigateToSettings = () => {
  router.push("/settings");
};
