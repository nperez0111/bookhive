import { router } from "expo-router";

export const navigateToProfile = (did: string) => {
  router.push(`/profile/${did}`);
};

export const navigateToBook = (hiveId: string) => {
  router.push(`/book/${hiveId}`);
};

export const navigateToSearch = () => {
  router.push("/search");
};

export const navigateToHome = () => {
  router.push("/");
};

export const navigateToSettings = () => {
  router.push("/settings");
};
