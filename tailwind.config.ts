import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      /* -------------------------------------------------------
         Colors: wire CSS variable tokens → hsl(var(--token)).
         shadcn naming so primitives use bg-background, text-foreground…
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

        /* back-compat names — now resolve to the editorial palette so
           not-yet-migrated screens recolor cleanly (no loud orange,
           no machined surfaces). */
        blaze:              "hsl(var(--blaze))",
        amber:              "hsl(var(--amber))",
        deck:   { DEFAULT:  "hsl(var(--deck))" },
        well:   { DEFAULT:  "hsl(var(--well))",  foreground: "hsl(var(--well-foreground))" },
        bezel:  { DEFAULT:  "hsl(var(--bezel))", foreground: "hsl(var(--bezel-foreground))" },
        hud:                "hsl(var(--hud))",
        seam:               "hsl(var(--seam))",
      },

      /* -------------------------------------------------------
         Border radius — gentle editorial, never square, never pill.
         ------------------------------------------------------- */
      borderRadius: {
        none:    "0",
        DEFAULT: "var(--radius)",           /* 0.375rem */
        sm:      "calc(var(--radius) - 2px)",
        md:      "var(--radius)",
        lg:      "calc(var(--radius) + 3px)",
        xl:      "calc(var(--radius) + 7px)",
        full:    "9999px",
      },

      /* -------------------------------------------------------
         Font families — wired to next/font CSS vars.
         display = Fraunces serif; sans = Inter; mono = IBM Plex Mono.
         ------------------------------------------------------- */
      fontFamily: {
        sans:    ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "Times New Roman", "serif"],
        mono:    ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },

      letterSpacing: {
        /* retained name; eased to a refined editorial cap-spacing */
        legend: "0.12em",
      },

      /* -------------------------------------------------------
         Animation — gentle, editorial. Subtle fade/rise only.
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
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.4s ease-out both",
      },

      transitionTimingFunction: {
        crisp:  "cubic-bezier(0.22, 1, 0.36, 1)",
        snappy: "cubic-bezier(0.16, 1, 0.3, 1)",
      },

      /* -------------------------------------------------------
         Box shadow — flat editorial: at most one soft low shadow.
         Legacy names ('bezel'/'rail'/'well'/'pressed'/'press-in'/
         'letterpress') survive but resolve to none or the soft lift,
         so unmigrated screens lose their machined depth gracefully.
         ------------------------------------------------------- */
      boxShadow: {
        none:        "none",
        soft:        "0 1px 2px 0 hsl(var(--shadow-soft)), 0 12px 32px -18px hsl(var(--shadow-lift))",
        lift:        "0 1px 2px 0 hsl(var(--shadow-soft)), 0 8px 24px -12px hsl(var(--shadow-lift))",
        hairline:    "inset 0 0 0 1px hsl(var(--border))",
        /* back-compat → flattened */
        letterpress: "none",
        "press-in":  "none",
        bezel:       "0 1px 2px 0 hsl(var(--shadow-soft))",
        "bezel-lg":  "0 1px 2px 0 hsl(var(--shadow-soft)), 0 8px 24px -12px hsl(var(--shadow-lift))",
        rail:        "none",
        well:        "none",
        pressed:     "none",
      },
    },
  },
  plugins: [],
};

export default config;
