"use client";

import { motion } from "framer-motion";
import { Mountain } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  tagline: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Centered access panel for /login and /signup (refined skin).
 * A flat, machined card: square corners, 1px hairline frame, letterpress
 * edge, a square instrument plate for the mark — no rounded bubble, no blur.
 * Mounts with a crisp fade-up (respects reduced-motion via CSS).
 */
export function AuthCard({ tagline, children, footer }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "relative w-full max-w-sm",
          "rounded-none border border-border bg-card shadow-letterpress",
        )}
      >
        {/* corner registration tick */}
        <span className="tick-accent" aria-hidden />

        {/* Header plate */}
        <div className="flex flex-col items-center gap-3 border-b border-border px-8 py-7 text-center">
          <span
            className="flex h-10 w-10 items-center justify-center border border-blaze text-blaze"
            aria-hidden
          >
            <Mountain className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="heading-display text-2xl tracking-legend text-foreground">Armarium</h1>
            <p className="data-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
              {tagline}
            </p>
          </div>
        </div>

        {/* Form slot */}
        <div className="px-8 py-7">
          {children}

          {/* Footer link */}
          {footer && (
            <p className="mt-5 border-t border-border pt-4 text-center text-sm text-muted-foreground">
              {footer}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
