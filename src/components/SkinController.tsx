"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Route-transition wrapper — a single, calm editorial design language across
 * every route (no skin flipping). On navigation, page content does a gentle
 * fade + rise. That's the whole job now; the old rugged/refined skin swap and
 * its cross-tone wipe are gone (one warm light theme, set on <html> in layout).
 */
interface Props {
  children: React.ReactNode;
}

export function SkinController({ children }: Props) {
  const pathname = usePathname();

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const variants = prefersReducedMotion
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit:    { opacity: 0, y: -4 },
      };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={variants.initial}
        animate={variants.animate}
        exit={variants.exit}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        style={{ minHeight: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
