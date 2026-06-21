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

        /* sharp orange punctuation — consistent across both skins */
        blaze:              "hsl(var(--blaze))",
      },

      /* -------------------------------------------------------
         Border radius: near-square, architectural.
         Interactive elements get ~2px; structural panels get 0.
         ------------------------------------------------------- */
      borderRadius: {
        none:     "0",
        DEFAULT:  "0.125rem",        /* 2px — interactive */
        sm:       "0.0625rem",       /* 1px — chips/inputs */
        md:       "0.125rem",
        lg:       "0",               /* structural panels/cards — square */
        full:     "9999px",          /* reserved (status dots only) */
      },

      /* -------------------------------------------------------
         Font families: wired to CSS vars set by next/font
         display = condensed structural; mono = technical data
         ------------------------------------------------------- */
      fontFamily: {
        sans:    ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-inter)", "ui-sans-serif", "sans-serif"],
        mono:    ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },

      letterSpacing: {
        legend: "0.14em",            /* topo-legend label spacing */
      },

      /* -------------------------------------------------------
         Animation keyframes — crisp, mechanical, no overshoot
         ------------------------------------------------------- */
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        /* a confident left→right wipe reveal (instrument readout) */
        "wipe-in": {
          from: { opacity: "0", clipPath: "inset(0 100% 0 0)" },
          to:   { opacity: "1", clipPath: "inset(0 0 0 0)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition:  "200% 0" },
        },
      },
      animation: {
        "fade-up":  "fade-up 0.26s cubic-bezier(0.22,1,0.36,1) both",
        "fade-in":  "fade-in 0.20s ease-out both",
        "wipe-in":  "wipe-in 0.34s cubic-bezier(0.22,1,0.36,1) both",
        shimmer:    "shimmer 1.6s linear infinite",
      },

      transitionTimingFunction: {
        /* sharp ease-out — decisive, zero bounce */
        crisp:   "cubic-bezier(0.22, 1, 0.36, 1)",
        snappy:  "cubic-bezier(0.16, 1, 0.3, 1)",
      },

      /* -------------------------------------------------------
         Box shadow: hairline edges + letterpress depth.
         NO soft blur drop-shadows — surfaces sit flat + defined.
         ------------------------------------------------------- */
      boxShadow: {
        none:        "none",
        hairline:    "inset 0 0 0 1px hsl(var(--hairline))",
        letterpress: "inset 0 1px 0 0 hsl(var(--letterpress)), inset 0 -1px 0 0 hsl(var(--inkpress))",
        "press-in":  "inset 0 1px 2px 0 hsl(var(--inkpress))",
      },
    },
  },
  plugins: [],
};

export default config;
