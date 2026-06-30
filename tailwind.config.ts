import type { Config } from "tailwindcss";

/**
 * Design tokens — adapted from the Tachyon (School of Athens) marketing site.
 * Colors reference CSS variables (RGB channels) defined in globals.css so the
 * same classes work in light and dark. Retheme by editing those vars.
 */
export default {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "rgb(var(--color-paper) / <alpha-value>)",
          soft: "rgb(var(--color-paper-soft) / <alpha-value>)",
          deep: "rgb(var(--color-paper-deep) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          soft: "rgb(var(--color-ink-soft) / <alpha-value>)",
          muted: "rgb(var(--color-ink-muted) / <alpha-value>)",
          faint: "rgb(var(--color-ink-faint) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--color-line) / <alpha-value>)",
          strong: "rgb(var(--color-line-strong) / <alpha-value>)",
        },
        accent: {
          50: "rgb(var(--color-accent-50) / <alpha-value>)",
          100: "rgb(var(--color-accent-100) / <alpha-value>)",
          200: "rgb(var(--color-accent-200) / <alpha-value>)",
          300: "rgb(var(--color-accent-300) / <alpha-value>)",
          400: "rgb(var(--color-accent-400) / <alpha-value>)",
          500: "rgb(var(--color-accent-500) / <alpha-value>)",
          600: "rgb(var(--color-accent-600) / <alpha-value>)",
          700: "rgb(var(--color-accent-700) / <alpha-value>)",
          800: "rgb(var(--color-accent-800) / <alpha-value>)",
          900: "rgb(var(--color-accent-900) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        sans: ["var(--font-sans)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-2xl": ["clamp(3rem, 9vw, 8rem)", { lineHeight: "0.92", letterSpacing: "-0.035em" }],
        "display-xl": ["clamp(2.5rem, 6vw, 5rem)", { lineHeight: "0.96", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(2rem, 4.2vw, 3.5rem)", { lineHeight: "1.0", letterSpacing: "-0.025em" }],
        "display-md": ["clamp(1.6rem, 3vw, 2.5rem)", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
      },
      letterSpacing: {
        label: "0.22em",
      },
      maxWidth: {
        page: "78rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
