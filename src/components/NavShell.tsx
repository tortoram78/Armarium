"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { NavUser } from "@/components/NavUser";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Props {
  userEmail: string | null;
  authConfigured: boolean;
  /** True when auth is configured but no session — a guest browsing the sample closet (demo funnel). */
  isGuest?: boolean;
}

const NAV_LINKS = [
  { href: "/",             label: "Closet" },
  { href: "/collections",  label: "Collections" },
  { href: "/items/new",    label: "Add gear" },
  { href: "/plan",         label: "Plan" },
  { href: "/trips",        label: "Trips" },
] as const;

/**
 * Editorial top nav — a clean, readable masthead. Fraunces wordmark, calm underline active state.
 * Responsive: the link row + auth controls show inline from `sm` up; below `sm` they collapse into a
 * hamburger sheet so the masthead never overflows a phone (the theme toggle stays inline at every size).
 */
export function NavShell({ userEmail, authConfigured, isGuest = false }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the sheet on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc closes the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6 lg:px-8">
        {/* Wordmark — refined serif */}
        <Link
          href="/"
          className="font-display text-[1.375rem] font-medium tracking-[-0.01em] text-foreground transition-opacity hover:opacity-70"
          aria-label="Armarium home"
        >
          Armarium
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Desktop link row (hidden on phones — collapses into the sheet below) */}
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main navigation">
            {NAV_LINKS.map(({ href, label }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ease-crisp",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                  <span
                    className={cn(
                      "pointer-events-none absolute inset-x-3 -bottom-px h-0.5 origin-left rounded-full bg-primary transition-transform duration-200 ease-crisp",
                      active ? "scale-x-100" : "scale-x-0",
                    )}
                    aria-hidden
                  />
                </Link>
              );
            })}
          </nav>

          {/* Theme toggle — visible at every size. */}
          <span className="ml-1 flex items-center border-l border-border pl-1 sm:pl-2">
            <ThemeToggle />
          </span>

          {/* Desktop auth controls */}
          {authConfigured && !isGuest && (
            <span className="ml-2 hidden items-center gap-3 border-l border-border pl-3 sm:flex">
              <Link
                href="/settings"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Settings
              </Link>
              <NavUser email={userEmail} />
            </span>
          )}
          {authConfigured && isGuest && (
            <span className="ml-2 hidden items-center gap-2 border-l border-border pl-3 sm:flex">
              <span className="eyebrow text-accent" aria-label="Viewing sample closet">Sample</span>
              <Link
                href="/login"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 ease-crisp hover:text-foreground"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92"
              >
                Sign up
              </Link>
            </span>
          )}

          {/* Mobile hamburger (below sm) */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="ml-1 inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground sm:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile sheet (below sm) */}
      {open && (
        <nav id="mobile-nav" className="border-t border-border bg-background sm:hidden" aria-label="Main navigation">
          <div className="mx-auto flex max-w-6xl flex-col gap-0.5 px-6 py-3">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive(href)
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
            {authConfigured && !isGuest && (
              <Link
                href="/settings"
                className="rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                Settings
              </Link>
            )}
            {authConfigured && !isGuest && (
              <div className="mt-1 border-t border-border pt-3">
                <NavUser email={userEmail} />
              </div>
            )}
            {authConfigured && isGuest && (
              <div className="mt-1 flex items-center gap-2 border-t border-border pt-3">
                <Link
                  href="/login"
                  className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
