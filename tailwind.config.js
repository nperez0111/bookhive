import tailwindAnimated from "tailwindcss-animated";
import forms from "@tailwindcss/forms";
import * as tailwindcss from "tailwindcss";

/** @type {tailwindcss.Config} */
export default {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        yello: "#f9eabc",
      },
    },
  },
  plugins: [tailwindAnimated, forms],
};
