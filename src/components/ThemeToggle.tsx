"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ThemeToggle — a refined sun/moon control for the editorial dark mode.
 *
 * Resolution order (matches the inline no-flash script in layout.tsx):
 *   stored choice  >  system preference  >  light
 *
 * - A manual toggle writes the choice to localStorage and overrides the system
 *   preference; the inline script reads it before first paint so there is no flash.
 * - With NO stored choice, we follow `prefers-color-scheme` live (a user who flips
 *   their OS to dark updates here too). Once they pick manually, that wins until cleared.
 * - The button is a real <button> (keyboard-operable) with an aria-label; the icon is
 *   decorative. We render a stable, inert placeholder until mounted to avoid a hydration
 *   mismatch (the server can't know the client's resolved theme).
 */

// Shared with the inline script in layout.tsx — keep both in sync.
const STORAGE_KEY = "armarium-theme";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readResolvedTheme(): Theme {
  // Reflect whatever the inline script already resolved onto <html>.
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = React.useState(false);
  const [theme, setTheme] = React.useState<Theme>("light");

  React.useEffect(() => {
    setMounted(true);
    setTheme(readResolvedTheme());

    // Follow the OS only while the user has made no explicit choice.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = (e: MediaQueryListEvent) => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return; // manual choice wins
      const next: Theme = e.matches ? "dark" : "light";
      applyTheme(next);
      setTheme(next);
    };
    mql.addEventListener("change", onSystemChange);
    return () => mql.removeEventListener("change", onSystemChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — the in-session toggle still works */
    }
  }

  const isDark = theme === "dark";

  // Calm, editorial icon button: ghost styling, hairline-quiet, matches the nav links.
  const base = cn(
    "inline-flex h-9 w-9 items-center justify-center rounded-md",
    "text-muted-foreground transition-colors duration-200 ease-crisp",
    "hover:bg-secondary hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    className,
  );

  if (!mounted) {
    // Inert, theme-agnostic placeholder so SSR markup matches the first client paint.
    return (
      <span className={base} aria-hidden suppressHydrationWarning>
        <Sun className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={base}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? (
        <Moon className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.75} aria-hidden />
      ) : (
        <Sun className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}
