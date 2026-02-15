import tailwindAnimated from "tailwindcss-animated";
import forms from "@tailwindcss/forms";
import * as tailwindcss from "tailwindcss";

/** @type {tailwindcss.Config} */
export default {
  content: ["./src/index.css", "./src/pages/**/*.{js,ts,jsx,tsx}", "./src/client/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        yello: '#f9eabc',
      },
    },
  },
  plugins: [
    tailwindAnimated,
    forms,
  ],
};
