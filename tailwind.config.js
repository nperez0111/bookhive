import tailwindAnimated from "tailwindcss-animated";
import forms from "@tailwindcss/forms";

/** @type {import("tailwindcss").Config} */
export default {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {},
  plugins: [tailwindAnimated, forms],
};
