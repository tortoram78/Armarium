import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      /* -------------------------------------------------------
         Colors: wire CSS variable tokens → hsl(var(--token))
         These follow shadcn-ui naming convention so primitives
         just use e.g. bg-background, text-foreground, etc.
         ------------------------------------------------------- */
      colors: {
        background:         "hsl(var(--background))",
        foreground:         "hsl(var(--foreground))",

        card: {
          DEFAULT:          "hsl(var(--card))",
          foreground:       "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:          "hsl(var(--popover))",
          foreground:       "hsl(var(--popover-foreground))",
        },

        primary: {
          DEFAULT:          "hsl(var(--primary))",
          foreground:       "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:          "hsl(var(--secondary))",
          foreground:       "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:          "hsl(var(--muted))",
          foreground:       "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:          "hsl(var(--accent))",
          foreground:       "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:          "hsl(var(--destructive))",
          foreground:       "hsl(var(--destructive-foreground))",
        },

        border:             "hsl(var(--border))",
        input:              "hsl(var(--input))",
        ring:               "hsl(var(--ring))",
      },

      /* -------------------------------------------------------
         Border radius: token-driven
         ------------------------------------------------------- */
      borderRadius: {
        DEFAULT:  "var(--radius)",
        lg:       "var(--radius)",
        md:       "calc(var(--radius) - 2px)",
        sm:       "calc(var(--radius) - 4px)",
        full:     "9999px",
      },

      /* -------------------------------------------------------
         Font families: wired to CSS vars set by next/font
         ------------------------------------------------------- */
      fontFamily: {
        sans:    ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-inter)", "ui-sans-serif", "sans-serif"],
        mono:    ["ui-monospace", "SFMono-Regular", "monospace"],
      },

      /* -------------------------------------------------------
         Animation keyframes for framer-motion companions
         (CSS fallback animations for mount/unmount)
         ------------------------------------------------------- */
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition:  "200% 0" },
        },
      },
      animation: {
        "fade-up":  "fade-up 0.35s ease both",
        "fade-in":  "fade-in 0.25s ease both",
        shimmer:    "shimmer 1.6s linear infinite",
      },

      /* -------------------------------------------------------
         Box shadow: token-accented shadows
         ------------------------------------------------------- */
      boxShadow: {
        card:    "0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)",
        "card-hover": "0 4px 12px 0 rgb(0 0 0 / 0.12)",
        glow:    "0 0 0 3px hsl(var(--ring) / 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
