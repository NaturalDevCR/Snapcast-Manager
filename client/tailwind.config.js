/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // We will force dark class on HTML element
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#a60df2',
          bg: '#1c1022',
          surface: '#f7f5f8', // Used very sparingly/never in pure dark
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
