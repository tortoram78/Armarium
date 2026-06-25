"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  /** A calm subhead under the heading (e.g. "Sign in to access your gear closet."). */
  tagline: string;
  /** The confident serif heading for this screen (e.g. "Welcome back"). */
  heading: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Shared auth shell for /login, /signup, /forgot-password, /update-password.
 *
 * A refined, centered editorial card — the premium outdoor-editorial language:
 * warm card on warm paper, a single soft low elevation, hairline rule, generous
 * air. The Armarium wordmark in Fraunces sits at the top, above a confident serif
 * heading and a calm subhead. No machined bezel, no HUD chrome, no stencil — this
 * reads like a high-end brand's sign-in, not a tactical panel. Mounts with a
 * subtle fade-up (respects reduced-motion via CSS).
 */
export function AuthCard({ tagline, heading, children, footer }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-14">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={cn("panel elev-soft w-full max-w-sm px-7 py-9 sm:px-9 sm:py-10")}
      >
        {/* Wordmark + heading */}
        <div className="space-y-5">
          <span className="font-display text-[1.375rem] font-medium tracking-[-0.01em] text-foreground">
            Armarium
          </span>
          <div className="space-y-2">
            <h1 className="display-md text-foreground">{heading}</h1>
            <p className="text-[0.95rem] leading-relaxed text-muted-foreground">{tagline}</p>
          </div>
        </div>

        {/* Form slot */}
        <div className="mt-8">
          {children}

          {/* Footer link */}
          {footer && (
            <p className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
              {footer}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
