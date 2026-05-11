/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hive: {
          bg: '#0a0a0f',
          surface: '#12121a',
          border: '#1e1e2e',
          primary: '#6366f1',
          primaryHover: '#4f46e5',
          text: '#e0e0e0',
          textSecondary: '#71717a',
          hover: '#1e1e2e',
        },
      },
    },
  },
  plugins: [],
}
