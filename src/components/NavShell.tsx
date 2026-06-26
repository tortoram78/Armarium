"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * Editorial top nav — a clean, readable masthead. Fraunces wordmark, calm
 * underline active state, generous spacing, a refined user/guest affordance.
 * One warm theme; no skin-flip chrome.
 */
export function NavShell({ userEmail, authConfigured, isGuest = false }: Props) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6 lg:px-8">
        {/* Wordmark — refined serif */}
        <Link
          href="/"
          className="font-display text-[1.375rem] font-medium tracking-[-0.01em] text-foreground transition-opacity hover:opacity-70"
          aria-label="Armarium home"
        >
          Armarium
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <nav className="flex items-center gap-1" aria-label="Main navigation">
            {NAV_LINKS.map(({ href, label }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ease-crisp",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
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

          {/* Theme toggle — a calm sun/moon control, separated by a hairline. */}
          <span className="ml-1 flex items-center border-l border-border pl-1 sm:pl-2">
            <ThemeToggle />
          </span>

          {authConfigured && !isGuest && (
            <span className="ml-2 flex items-center border-l border-border pl-3">
              <NavUser email={userEmail} />
            </span>
          )}
          {authConfigured && isGuest && (
            <span className="ml-2 flex items-center gap-2 border-l border-border pl-3">
              <span
                className="hidden eyebrow text-accent sm:inline"
                aria-label="Viewing sample closet"
              >
                Sample
              </span>
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
        </div>
      </div>
    </header>
  );
}
