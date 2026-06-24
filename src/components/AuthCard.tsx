"use client";

import { motion } from "framer-motion";
import { Mountain } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  tagline: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Section code stamped behind the header (e.g. "IN" for sign-in). */
  code?: string;
}

/**
 * Centered access panel for /login and /signup (refined skin).
 * A raised machined plate: square corners, milled bevel + hard cast, 4-corner
 * HUD registration brackets, a ghosted stencil code, a recessed instrument
 * plate for the mark — no rounded bubble, no soft glow. Mounts with a crisp
 * fade-up (respects reduced-motion via CSS).
 */
export function AuthCard({ tagline, children, footer, code = "AC" }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={cn("hud-brackets surface-bezel relative w-full max-w-sm overflow-hidden")}
      >
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        {/* ghosted stencil code behind the header */}
        <span
          className="hud-stencil pointer-events-none absolute -right-1 -top-4 text-[5.5rem]"
          aria-hidden
        >
          {code}
        </span>
        {/* recessed screw at the panel corner (sparing hardware) */}
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        {/* Header plate — recessed instrument well */}
        <div className="surface-well relative m-3 flex flex-col items-center gap-3 px-8 py-7 text-center">
          <span
            className="surface-bezel flex h-10 w-10 items-center justify-center text-blaze"
            aria-hidden
          >
            <Mountain className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="heading-display text-stamped text-2xl tracking-legend text-foreground">Armarium</h1>
            <div className="flex items-center gap-2">
              <span className="hud-pip" aria-hidden />
              <p className="hud-readout text-[0.5625rem] tracking-[0.18em]">{tagline}</p>
            </div>
          </div>
        </div>

        {/* Form slot */}
        <div className="relative px-6 pb-6 pt-1">
          {children}

          {/* Footer link */}
          {footer && (
            <p className="mt-5 border-t border-seam/40 pt-4 text-center text-sm text-muted-foreground">
              {footer}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
