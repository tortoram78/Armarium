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
 * Centered card used on /login and /signup.
 * Mounts with a subtle fade-up animation (respects reduced-motion via CSS).
 * Uses refined skin tokens (clean, professional).
 */
export function AuthCard({ tagline, children, footer }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={cn(
          "w-full max-w-sm",
          "rounded-[var(--radius)] border border-border bg-card shadow-card",
          "px-8 py-10",
        )}
      >
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center gap-1 text-center">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <Mountain className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Armarium</h1>
          <p className="text-sm text-muted-foreground">{tagline}</p>
        </div>

        {/* Form slot */}
        {children}

        {/* Footer link */}
        {footer && (
          <p className="mt-5 text-center text-sm text-muted-foreground">{footer}</p>
        )}
      </motion.div>
    </div>
  );
}
