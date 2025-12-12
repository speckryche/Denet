/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "#0F1419", // Deep charcoal base
        foreground: "#F5F1E8", // Warm cream
        primary: {
          DEFAULT: "#0066FF", // Electric blue
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "#FF9500", // Muted amber
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "#1E2329", // Slightly lighter charcoal
          foreground: "#A0A5AA",
        },
        accent: {
          DEFAULT: "#1E2329",
          foreground: "#F5F1E8",
        },
        popover: {
          DEFAULT: "#0F1419",
          foreground: "#F5F1E8",
        },
        card: {
          DEFAULT: "#161B22", // Slightly lighter for cards
          foreground: "#F5F1E8",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}