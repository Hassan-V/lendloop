import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6f3",
          100: "#d5ebe2",
          500: "#2a7b5c",
          600: "#21634a",
          700: "#194d39",
        },
      },
    },
  },
  plugins: [],
};

export default config;
