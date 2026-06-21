"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mountain } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavUser } from "@/components/NavUser";

interface Props {
  userEmail: string | null;
  authConfigured: boolean;
}

const NAV_LINKS = [
  { href: "/",           label: "Closet" },
  { href: "/items/new",  label: "Add" },
  { href: "/plan",       label: "Plan" },
  { href: "/trips",      label: "Trips" },
] as const;

/**
 * Field-instrument header: flat pine/paper bar, hairline bottom rule,
 * uppercase letter-spaced nav labels with a blaze-orange active tick.
 * No drop-shadow, no pill — depth is the 1px rule + letterpress edge.
 */
export function NavShell({ userEmail, authConfigured }: Props) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/95 shadow-letterpress backdrop-blur-sm transition-colors duration-300">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        {/* Brand wordmark — instrument plate */}
        <Link
          href="/"
          className="group flex items-center gap-2.5 text-foreground"
          aria-label="Armarium home"
        >
          <span
            className="flex h-7 w-7 items-center justify-center border border-blaze text-blaze transition-colors group-hover:bg-blaze group-hover:text-background"
            aria-hidden
          >
            <Mountain className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="heading-display text-base tracking-legend text-foreground">
              Armarium
            </span>
            <span className="data-mono text-[0.5rem] uppercase tracking-[0.2em] text-muted-foreground">
              gear&nbsp;·&nbsp;field&nbsp;index
            </span>
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="flex items-stretch gap-0" aria-label="Main navigation">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "label-structural relative flex items-center px-3 text-[0.6875rem] transition-colors duration-150 ease-crisp",
                isActive(href)
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive(href) ? "page" : undefined}
            >
              {label}
              {/* active = blaze-orange underline tick (sharp punctuation) */}
              <span
                className={cn(
                  "pointer-events-none absolute inset-x-2 -bottom-px h-0.5 origin-left transition-transform duration-150 ease-crisp",
                  isActive(href) ? "scale-x-100 bg-blaze" : "scale-x-0 bg-transparent",
                )}
                aria-hidden
              />
            </Link>
          ))}
          {authConfigured && (
            <span className="ml-2 flex items-center border-l border-border pl-2">
              <NavUser email={userEmail} />
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
