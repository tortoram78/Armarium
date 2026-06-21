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
  { href: "/items/new",  label: "Add item" },
  { href: "/plan",       label: "Plan" },
  { href: "/trips",      label: "Trips" },
] as const;

/**
 * Adaptive navigation shell that reads the current skin from the pathname
 * and adjusts its visual treatment accordingly.
 *
 * Rugged skin  → dark pine header, warm sand links, blaze-orange active state
 * Refined skin → white header, evergreen brand, neutral nav
 */
export function NavShell({ userEmail, authConfigured }: Props) {
  const pathname = usePathname();

  // Determine active link: exact match for "/" otherwise prefix
  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card shadow-card backdrop-blur-sm transition-colors duration-300">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        {/* Brand wordmark */}
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground transition-opacity hover:opacity-80"
          aria-label="Armarium home"
        >
          <Mountain
            className="h-5 w-5 text-primary"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="font-display text-lg font-semibold uppercase tracking-wider text-foreground">
            Armarium
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="flex items-center gap-0.5 text-sm" aria-label="Main navigation">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors duration-150",
                isActive(href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
              aria-current={isActive(href) ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
          {authConfigured && <NavUser email={userEmail} />}
        </nav>
      </div>
    </header>
  );
}
