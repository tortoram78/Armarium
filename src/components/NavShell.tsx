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
  { href: "/",           label: "Closet", code: "01" },
  { href: "/items/new",  label: "Add",    code: "02" },
  { href: "/plan",       label: "Plan",   code: "03" },
  { href: "/trips",      label: "Trips",  code: "04" },
] as const;

/**
 * Tactical instrument header — a raised machined rail.
 * Milled bevel (bright top-left / dark bottom-right) + a hard cast underneath,
 * a faint mono coordinate readout, a stamped wordmark, and a blaze active tick.
 * Depth is the milled edge + cast, never a soft drop-shadow.
 */
export function NavShell({ userEmail, authConfigured }: Props) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="surface-rail sticky top-0 z-50 backdrop-blur-sm transition-colors duration-300">
      {/* hairline blaze indexing line across the very top edge */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-blaze/30" aria-hidden />

      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        {/* Brand wordmark — stamped instrument plate */}
        <Link
          href="/"
          className="group flex items-center gap-2.5 text-foreground"
          aria-label="Armarium home"
        >
          <span
            className="surface-bezel flex h-7 w-7 items-center justify-center text-blaze transition-colors group-hover:text-background group-hover:[background-color:hsl(var(--blaze))]"
            aria-hidden
          >
            <Mountain className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="heading-display text-stamped text-base tracking-legend text-foreground">
              Armarium
            </span>
            <span className="hud-readout text-[0.5rem] tracking-[0.22em]">
              sec&nbsp;01&nbsp;·&nbsp;field&nbsp;index
            </span>
          </span>
        </Link>

        {/* Primary nav — recessed track holding raised tabs */}
        <nav
          className="surface-well flex items-stretch gap-0 px-1"
          aria-label="Main navigation"
        >
          {NAV_LINKS.map(({ href, label, code }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "label-structural group relative flex items-center gap-1.5 px-3 text-[0.6875rem] transition-colors duration-150 ease-crisp",
                  active
                    ? "text-foreground text-stamped [background-color:hsl(var(--bezel))] shadow-rail"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={cn(
                    "hud-readout text-[0.5rem] leading-none transition-colors",
                    active ? "text-blaze" : "text-hud/70",
                  )}
                  aria-hidden
                >
                  {code}
                </span>
                {label}
                {/* active = blaze-orange underline tick (sharp punctuation) */}
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-2 -bottom-px h-0.5 origin-left transition-transform duration-150 ease-crisp",
                    active ? "scale-x-100 bg-blaze" : "scale-x-0 bg-transparent",
                  )}
                  aria-hidden
                />
              </Link>
            );
          })}
          {authConfigured && (
            <span className="ml-1 flex items-center border-l border-seam/40 pl-2 pr-1">
              <NavUser email={userEmail} />
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
